// 責務: ensureIpForwardEnabled（IPフォワーディングの起動時チェック・補正）の単体テスト。
// 実際の/proc/sys/net/ipv4/ip_forwardは書き換えず、IP_FORWARD_PATH環境変数で一時ファイルに差し替える。
// sudoもSUDO_BIN環境変数でパススルースタブに差し替える。

import { describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdtempSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function stubSudoPassthrough(dir: string): string {
  const scriptPath = join(dir, "sudo-stub.sh");
  // "sudo tee <path>"を模倣: 標準入力の内容をそのまま指定ファイルへ書き込む（実teeと同等の最小実装）。
  writeFileSync(scriptPath, ['#!/bin/sh', '# $1=tee, $2=対象パス', 'cat > "$2"'].join("\n"));
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe("ensureIpForwardEnabled", () => {
  it("既に有効（\"1\"）な場合は書き込みを行わずfalseを返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    const path = join(dir, "ip_forward");
    writeFileSync(path, "1\n");
    process.env.IP_FORWARD_PATH = path;
    process.env.SUDO_BIN = stubSudoPassthrough(dir);

    vi.resetModules();
    const { ensureIpForwardEnabled } = await import("./ip-forward.js");
    expect(await ensureIpForwardEnabled()).toBe(false);
    expect(readFileSync(path, "utf8").trim()).toBe("1");
  });

  it("無効（\"0\"）な場合は\"1\"へ書き換えtrueを返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    const path = join(dir, "ip_forward");
    writeFileSync(path, "0\n");
    process.env.IP_FORWARD_PATH = path;
    process.env.SUDO_BIN = stubSudoPassthrough(dir);

    vi.resetModules();
    const { ensureIpForwardEnabled } = await import("./ip-forward.js");
    expect(await ensureIpForwardEnabled()).toBe(true);
    expect(readFileSync(path, "utf8").trim()).toBe("1");
  });

  it("対象ファイルが読めない場合は例外を投げずfalseを返す", async () => {
    process.env.IP_FORWARD_PATH = "/nonexistent/path/ip_forward";
    process.env.SUDO_BIN = "true";

    vi.resetModules();
    const { ensureIpForwardEnabled } = await import("./ip-forward.js");
    expect(await ensureIpForwardEnabled()).toBe(false);
  });
});

describe("isIpForwardEnabled", () => {
  it("\"1\"なら true、\"0\"なら false、ファイルが読めない場合は false を返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    const path = join(dir, "ip_forward");
    process.env.IP_FORWARD_PATH = path;

    vi.resetModules();
    const { isIpForwardEnabled } = await import("./ip-forward.js");

    expect(isIpForwardEnabled()).toBe(false); // 未作成
    writeFileSync(path, "0\n");
    expect(isIpForwardEnabled()).toBe(false);
    writeFileSync(path, "1\n");
    expect(isIpForwardEnabled()).toBe(true);
  });
});
