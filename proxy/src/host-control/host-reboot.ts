// 責務: ホスト（ベアメタル）の再起動を依頼する。依頼用ディレクトリ（ホストと共有）へ依頼ファイルを作成するだけで、
// 再起動そのものは行わない（ホスト側のsystemdのpathユニットが検知して実行する。proxyserver/design.md「ホストの再起動依頼」）。
// コンテナへホストの特権を与えないための分離である。

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const HOST_CTL_DIR = process.env.HOST_CTL_DIR ?? "/var/run/vpngw-host-ctl";
const REQUEST_FILE_NAME = "reboot-request";

export type HostRebootResult = "requested" | "already_requested" | "unavailable";

/**
 * 目的: ホストの再起動を依頼する。
 * 入力: dir(依頼用ディレクトリ。省略時はHOST_CTL_DIR)。
 * 出力: 依頼ファイルを作成できれば"requested"、すでに残っていれば"already_requested"、
 *      ディレクトリが無い・書き込めない（ホスト側の仕組みが未導入）場合は"unavailable"。
 * 副作用: 依頼用ディレクトリへ`reboot-request`を排他的に作成する（内容は使われない）。
 */
export function requestHostReboot(dir: string = HOST_CTL_DIR): HostRebootResult {
  try {
    writeFileSync(join(dir, REQUEST_FILE_NAME), "", { flag: "wx" });
    return "requested";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EEXIST" ? "already_requested" : "unavailable";
  }
}
