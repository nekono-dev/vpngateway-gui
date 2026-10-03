import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(existsSync(join(dir, "reboot-request"))).toBe(true);
  });

  it("すでに依頼が残っていれば重ねて作らない", () => {
    const dir = makeDir();
    requestHostReboot(dir);
    expect(requestHostReboot(dir)).toBe("already_requested");
  });

  it("ディレクトリが無ければ利用不可", () => {
    expect(requestHostReboot(join(makeDir(), "none"))).toBe("unavailable");
  });
});
