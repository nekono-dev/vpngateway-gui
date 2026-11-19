// 責務: ホスト（ベアメタル）の再起動を依頼する。依頼用ディレクトリ（ホストと共有）へ依頼ファイルを作成するだけで、
// 再起動そのものは行わない（ホスト側のsystemdのpathユニットが検知して実行する）。
// コンテナへホストの特権を与えないための分離である。

import { closeSync, constants, fchmodSync, fsyncSync, linkSync, lstatSync, openSync, readdirSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const HOST_CTL_DIR = process.env.HOST_CTL_DIR ?? "/var/run/vpngw-host-ctl";
const REQUEST_FILE_NAME = "reboot-request";
// 一時ファイル名は .reboot-request.tmp.<digits>.<hex> に固定する。
const TEMP_FILE_PATTERN = /^\.reboot-request\.tmp\.[0-9]+\.[0-9a-f]{32}$/;
const TEMP_FILE_MAX_AGE_MS = 60_000;
const REQUEST_CONTENT = "vpngwgui-host-reboot-v1\n";

export interface HostRebootFileOperations {
  openSync: (path: string, flags: number, mode: number) => number;
  fchmodSync: typeof fchmodSync;
  writeSync: (fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null) => number;
  fsyncSync: typeof fsyncSync;
  closeSync: typeof closeSync;
  linkSync: typeof linkSync;
  unlinkSync: typeof unlinkSync;
}

const defaultFileOperations: HostRebootFileOperations = {
  openSync,
  fchmodSync,
  writeSync,
  fsyncSync,
  closeSync,
  linkSync,
  unlinkSync,
};

export type HostRebootResult = "requested" | "already_requested" | "unavailable";

/**
 * 目的: ホストの再起動を依頼する。
 * 入力: dir(依頼用ディレクトリ。省略時はHOST_CTL_DIR)。
 * 出力: 依頼ファイルを作成できれば"requested"、すでに残っていれば"already_requested"、
 *      ディレクトリが無い・書き込めない（ホスト側の仕組みが未導入）場合は"unavailable"。
 * 副作用: 固定内容・mode 0600 の一時ファイルを同期後、依頼先へ排他的に公開する。
 */
export function requestHostReboot(
  dir: string = HOST_CTL_DIR,
  fileOperations: HostRebootFileOperations = defaultFileOperations,
): HostRebootResult {
  cleanupStaleTemporaryFiles(dir);
  const requestPath = join(dir, REQUEST_FILE_NAME);
  const temporaryPath = join(dir, `.reboot-request.tmp.${process.pid}.${randomBytes(16).toString("hex")}`);
  let descriptor: number | undefined;
  let publicationAttempted = false;
  try {
    descriptor = fileOperations.openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    fileOperations.fchmodSync(descriptor, 0o600);
    const content = Buffer.from(REQUEST_CONTENT, "utf8");
    let written = 0;
    while (written < content.length) {
      const count = fileOperations.writeSync(descriptor, content, written, content.length - written, null);
      if (count <= 0) throw new Error("ホスト再起動依頼の書き込みが進みません");
      written += count;
    }
    fileOperations.fsyncSync(descriptor);
    fileOperations.closeSync(descriptor);
    descriptor = undefined;
    publicationAttempted = true;
    fileOperations.linkSync(temporaryPath, requestPath);
    return "requested";
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fileOperations.closeSync(descriptor);
      } catch {
        // 依頼の公開結果を優先し、後続の一時ファイル掃除を続ける。
      }
    }
    return publicationAttempted && (error as NodeJS.ErrnoException).code === "EEXIST"
      ? "already_requested"
      : "unavailable";
  } finally {
    try {
      fileOperations.unlinkSync(temporaryPath);
    } catch {
      // 公開前後を問わず一時ファイル削除を試み、削除不能時も監視パスの状態を変えない。
    }
  }
}

function cleanupStaleTemporaryFiles(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const now = Date.now();
  const uid = process.getuid?.();
  for (const entry of entries) {
    if (!TEMP_FILE_PATTERN.test(entry)) continue;
    const path = join(dir, entry);
    try {
      const before = lstatSync(path);
      if (!before.isFile() || before.isSymbolicLink() || before.uid !== uid || now - before.mtimeMs <= TEMP_FILE_MAX_AGE_MS) continue;
      const current = lstatSync(path);
      if (current.isFile() && !current.isSymbolicLink() && current.uid === uid && current.ino === before.ino && current.dev === before.dev && now - current.mtimeMs > TEMP_FILE_MAX_AGE_MS) unlinkSync(path);
    } catch {
      // stale cleanup is best effort; request publication remains authoritative.
    }
  }
}
