// 責務: ホスト再起動依頼の受付結果、原子的公開、同時要求を検証する。

import { closeSync, constants, fchmodSync, fsyncSync, linkSync, mkdtempSync, existsSync, openSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { requestHostReboot } from "./host-reboot.js";

describe("requestHostReboot", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "host-ctl-"));
    dirs.push(dir);
    return dir;
  }

  it("依頼ファイルを作成する", () => {
    const dir = makeDir();
    expect(requestHostReboot(dir)).toBe("requested");
    const requestPath = join(dir, "reboot-request");
    expect(existsSync(requestPath)).toBe(true);
    expect(readFileSync(requestPath, "utf8")).toBe("vpngwgui-host-reboot-v1\n");
    expect(statSync(requestPath).mode & 0o777).toBe(0o600);
    expect(statSync(requestPath).uid).toBe(process.getuid?.());
    expect(statSync(requestPath).gid).toBe(process.getgid?.());
  });

  it("すでに依頼が残っていれば重ねて作らない", () => {
    const dir = makeDir();
    requestHostReboot(dir);
    expect(requestHostReboot(dir)).toBe("already_requested");
  });

  it("既存のシンボリックリンクを追跡せず依頼済みとして扱う", () => {
    const dir = makeDir();
    const targetPath = join(dir, "target");
    const requestPath = join(dir, "reboot-request");
    writeFileSync(targetPath, "unchanged");
    symlinkSync(targetPath, requestPath);

    expect(requestHostReboot(dir)).toBe("already_requested");
    expect(readFileSync(targetPath, "utf8")).toBe("unchanged");
  });

  it("完全な内容を同期するまで監視対象の依頼パスを公開しない", () => {
    const dir = makeDir();
    const requestPath = join(dir, "reboot-request");
    const calls: string[] = [];

    expect(requestHostReboot(dir, {
      openSync: (path, flags, mode) => {
        calls.push("open");
        expect(flags & constants.O_EXCL).toBe(constants.O_EXCL);
        expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
        expect(mode).toBe(0o600);
        return openSync(path, flags, mode);
      },
      fchmodSync: (fd, mode) => {
        calls.push("chmod");
        fchmodSync(fd, mode);
      },
      writeSync: (fd, content, offset, length, position) => {
        calls.push("write");
        return writeSync(fd, content, offset, length, position);
      },
      fsyncSync: (fd) => {
        calls.push("fsync");
        fsyncSync(fd);
      },
      closeSync: (fd) => {
        calls.push("close");
        closeSync(fd);
      },
      linkSync: (temporaryPath, finalPath) => {
        calls.push("link");
        expect(finalPath).toBe(requestPath);
        expect(existsSync(finalPath)).toBe(false);
        expect(readFileSync(temporaryPath, "utf8")).toBe("vpngwgui-host-reboot-v1\n");
        expect(statSync(temporaryPath).mode & 0o777).toBe(0o600);
        expect(calls).toEqual(["open", "chmod", "write", "fsync", "close", "link"]);
        linkSync(temporaryPath, finalPath);
      },
      unlinkSync,
    })).toBe("requested");

    expect(calls).toEqual(["open", "chmod", "write", "fsync", "close", "link"]);
    expect(readFileSync(requestPath, "utf8")).toBe("vpngwgui-host-reboot-v1\n");
  });

  it("公開前の失敗時に一時ファイルを掃除し利用不可を返す", () => {
    const dir = makeDir();
    expect(requestHostReboot(dir, {
      openSync,
      fchmodSync,
      writeSync,
      fsyncSync: () => { throw new Error("fsync failed"); },
      closeSync,
      linkSync,
      unlinkSync,
    })).toBe("unavailable");
    expect(existsSync(join(dir, "reboot-request"))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("同時要求では hard link の排他性により一件だけを受け付ける", async () => {
    const dir = makeDir();
    const source = readFileSync(new URL("./host-reboot.ts", import.meta.url), "utf8");
    const moduleCode = transpileModule(source, {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    }).outputText;
    const startWorker = () => new Promise<string>((resolve, reject) => {
      const worker = new Worker(
        `${moduleCode}\nconst { parentPort, workerData } = require("node:worker_threads"); parentPort.postMessage(exports.requestHostReboot(workerData.dir));`,
        { eval: true, workerData: { dir } },
      );
      worker.once("message", (result: string) => resolve(result));
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`reboot request worker exited with code ${code}`));
      });
    });

    expect((await Promise.all([startWorker(), startWorker()])).sort()).toEqual(["already_requested", "requested"]);
    expect(readFileSync(join(dir, "reboot-request"), "utf8")).toBe("vpngwgui-host-reboot-v1\n");
  });

  it("ディレクトリが無ければ利用不可", () => {
    expect(requestHostReboot(join(makeDir(), "none"))).toBe("unavailable");
  });

  it("依頼開始時に60秒を超えた製品一時ファイルだけを掃除する", () => {
    const dir = makeDir();
    const stalePath = join(dir, `.reboot-request.tmp.${process.pid}.abcdef0123456789abcdef0123456789`);
    const freshPath = join(dir, `.reboot-request.tmp.${process.pid}.fedcba9876543210fedcba9876543210`);
    writeFileSync(stalePath, "stale");
    writeFileSync(freshPath, "fresh");
    const old = new Date(Date.now() - 61_000);
    utimesSync(stalePath, old, old);

    expect(requestHostReboot(dir)).toBe("requested");
    expect(existsSync(stalePath)).toBe(false);
    expect(readFileSync(freshPath, "utf8")).toBe("fresh");
  });
});
