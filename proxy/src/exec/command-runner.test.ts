// 責務: runDetachableCommand（completionPattern一致時の早期応答・バックグラウンド継続実行）の単体テスト。
// 実VPNベンダーCLIのログイン代行が題材だが、実バイナリには依存せず`sh`スクリプトで挙動を再現する
// （proxyserver/design.md「実VPNベンダーCLI統合・ログイン代行 (Phase 2)」参照）。

import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand, runDetachableCommand } from "./command-runner.js";

describe("runCommand", () => {
  it("子プロセスがバックグラウンドに孫プロセスをforkし標準出力を引き継がせたまま先に終了しても、ハングせず応答する", async () => {
    // 実VPNベンダーCLIの`connect`が接続確立後にバックグラウンドデーモンをforkして自身は先に終了する
    // 挙動を再現する。孫プロセス（sleep）は標準出力を閉じずに保持し続ける。
    // execFileの'close'待ち実装ではこのケースでハングしていた（実機検証で発覚）。
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    const scriptPath = join(dir, "forks-daemon.sh");
    writeFileSync(
      scriptPath,
      ["#!/bin/sh", "echo 'connected'", "sleep 5 &", "exit 0"].join("\n"),
    );
    chmodSync(scriptPath, 0o755);

    const start = Date.now();
    const result = await runCommand(scriptPath, [], 3000);
    const elapsedMs = Date.now() - start;

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("connected");
    // タイムアウト(3000ms)や孫プロセスの終了(5000ms)を待たず、即座に応答するはず。
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("プロセスが終了しないままtimeoutMsを超過した場合はkillしexitCode=-1を返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    const scriptPath = join(dir, "never-exits.sh");
    writeFileSync(scriptPath, "#!/bin/sh\necho 'stuck'\nsleep 30\n");
    chmodSync(scriptPath, 0o755);

    const result = await runCommand(scriptPath, [], 300);

    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toContain("stuck");
  });

  it("プロセスが非ゼロで終了した場合は実際のexitCodeを返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    const scriptPath = join(dir, "fails.sh");
    writeFileSync(scriptPath, "#!/bin/sh\necho 'boom' 1>&2\nexit 11\n");
    chmodSync(scriptPath, 0o755);

    const result = await runCommand(scriptPath, [], 3000);

    expect(result.exitCode).toBe(11);
    expect(result.stderr).toContain("boom");
  });
});

// completionPatternに一致する行を出力した後もしばらく実行し続けるスクリプトを用意する。
// マーカーファイルへの書き込みにより、応答後もプロセスが実行継続していることを外部から確認できる。
function writeLoginLikeScript(markerFile: string): string {
  const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
  const scriptPath = join(dir, "login-like.sh");
  writeFileSync(
    scriptPath,
    [
      "#!/bin/sh",
      "echo 'please open: https://auth.example.com/device_code?user_code=ABCD'",
      "sleep 0.3",
      `echo done > '${markerFile}'`,
      "exit 0",
    ].join("\n"),
  );
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe("runDetachableCommand", () => {
  it("completionPatternに一致した時点でexitCode=nullとして応答し、プロセスはバックグラウンドで継続する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-marker-"));
    const markerFile = join(dir, "marker");
    const script = writeLoginLikeScript(markerFile);

    const result = await runDetachableCommand(script, [], 5000, "https://\\S+");

    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain("https://auth.example.com/device_code?user_code=ABCD");

    // 応答時点ではまだバックグラウンドの後続処理（sleep 0.3後のマーカー書き込み）が完了していないはず。
    // その後プロセスがkillされず実行継続していることを、マーカーファイルの出現で確認する。
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(readFileSync(markerFile, "utf8").trim()).toBe("done");
  });

  it("completionPatternに一致せずプロセスが終了した場合は実際のexitCodeを返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    const scriptPath = join(dir, "quick-exit.sh");
    writeFileSync(scriptPath, "#!/bin/sh\necho 'already logged in'\nexit 0\n");
    chmodSync(scriptPath, 0o755);

    const result = await runDetachableCommand(scriptPath, [], 5000, "https://\\S+");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("already logged in");
  });

  it("completionPatternに一致しないままtimeoutMsを超過した場合はプロセスをkillしexitCode=-1を返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    const scriptPath = join(dir, "never-matches.sh");
    writeFileSync(scriptPath, "#!/bin/sh\necho 'waiting forever'\nsleep 30\n");
    chmodSync(scriptPath, 0o755);

    const result = await runDetachableCommand(scriptPath, [], 300, "https://\\S+");

    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toContain("waiting forever");
  });

  it("completionPattern一致後、標準入力を読み続けても即座にEOFとならずブロックする（'pipe'指定の確認）", async () => {
    // 実VPNベンダーCLIが認証完了後にstdinから読み取ろうとして即時EOFを異常終了扱いしてしまう不具合の
    // 再現・回帰確認（wbs/phase2.md参照）。stdinが"ignore"（即時EOF）なら`read`が即座に失敗し
    // マーカーへ"got-eof-immediately"を書き込むが、"pipe"指定でブロックする場合は
    // `read -t 1`のタイムアウト（非ゼロ終了）により"blocked-as-expected"を書き込む。
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-marker-"));
    const markerFile = join(dir, "marker");
    const scriptPath = join(dir, "reads-stdin-after-match.sh");
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        "echo 'please open: https://auth.example.com/device_code?user_code=ABCD'",
        `if read -t 1 line; then echo 'got-eof-immediately' > '${markerFile}'; else echo 'blocked-as-expected' > '${markerFile}'; fi`,
        "exit 0",
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);

    const result = await runDetachableCommand(scriptPath, [], 5000, "https://\\S+");
    expect(result.exitCode).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(readFileSync(markerFile, "utf8").trim()).toBe("blocked-as-expected");
  });

  it("completionPattern一致後もプロセスが自然終了しない場合、backgroundTimeoutMs経過後に強制killしonBackgroundExitへ通知する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    const scriptPath = join(dir, "never-exits-after-match.sh");
    writeFileSync(
      scriptPath,
      ["#!/bin/sh", "echo 'please open: https://auth.example.com/device_code?user_code=ABCD'", "sleep 30"].join(
        "\n",
      ),
    );
    chmodSync(scriptPath, 0o755);

    const backgroundExits: Array<{ exitCode: number; killedByTimeout: boolean }> = [];
    const result = await runDetachableCommand(scriptPath, [], 5000, "https://\\S+", {
      backgroundTimeoutMs: 300,
      onBackgroundExit: (info) => backgroundExits.push(info),
    });

    expect(result.exitCode).toBeNull();
    expect(backgroundExits).toHaveLength(0);

    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(backgroundExits).toEqual([{ exitCode: -1, killedByTimeout: true }]);
  });

  it("completionPattern一致後にプロセスが自然終了した場合、onBackgroundExitへkilledByTimeout=falseで通知する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    const scriptPath = join(dir, "exits-naturally-after-match.sh");
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        "echo 'please open: https://auth.example.com/device_code?user_code=ABCD'",
        "sleep 0.3",
        "exit 0",
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);

    const backgroundExits: Array<{ exitCode: number; killedByTimeout: boolean }> = [];
    const result = await runDetachableCommand(scriptPath, [], 5000, "https://\\S+", {
      backgroundTimeoutMs: 60000,
      onBackgroundExit: (info) => backgroundExits.push(info),
    });

    expect(result.exitCode).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(backgroundExits).toEqual([{ exitCode: 0, killedByTimeout: false }]);
  });
});
