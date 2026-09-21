// 責務: runNftScript（`sudo nft -f -`実行）の単体テスト。実sudo/nftバイナリには依存せず、
// SUDO_BIN/NFT_BIN環境変数をスタブスクリプトに差し替えて検証する
// （command-runner.test.tsと同様、実バイナリの代わりにshスクリプトで挙動を再現する方針）。

import { describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdtempSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function stubSudoPassthrough(dir: string): string {
  // "sudo <cmd> <args...>"をそのまま実行するだけのスタブ（sudo自体の昇格処理は再現しない）。
  const scriptPath = join(dir, "sudo-stub.sh");
  writeFileSync(scriptPath, '#!/bin/sh\nexec "$@"\n');
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function stubNftScript(dir: string, body: string): string {
  const scriptPath = join(dir, "nft-stub.sh");
  writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe("runNftScript", () => {
  it("標準入力へスクリプトを渡し、正常終了時はexitCode=0で応答する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    process.env.SUDO_BIN = stubSudoPassthrough(dir);
    // 標準入力の内容をそのままstdoutへ出力するnftスタブ（受信したスクリプト内容の検証用）。
    process.env.NFT_BIN = stubNftScript(dir, "cat\nexit 0");

    vi.resetModules();
    const { runNftScript } = await import("./nft-client.js");
    const result = await runNftScript("add table inet vpngwgui\n");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("add table inet vpngwgui\n");
  });

  it("nftが非ゼロ終了した場合、実際のexitCodeとstderrを返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    process.env.SUDO_BIN = stubSudoPassthrough(dir);
    process.env.NFT_BIN = stubNftScript(dir, "cat > /dev/null\necho 'Error: no such file or directory' 1>&2\nexit 1");

    vi.resetModules();
    const { runNftScript } = await import("./nft-client.js");
    const result = await runNftScript("delete table inet vpngwgui\n");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no such file or directory");
  });

  it("timeoutMsを超過した場合はkillしexitCode=-1を返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    process.env.SUDO_BIN = stubSudoPassthrough(dir);
    process.env.NFT_BIN = stubNftScript(dir, "cat > /dev/null\nsleep 30");

    vi.resetModules();
    const { runNftScript } = await import("./nft-client.js");
    const result = await runNftScript("add table inet vpngwgui\n", 200);

    expect(result.exitCode).toBe(-1);
  });
});
