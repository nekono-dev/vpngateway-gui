// 責務: ランナーの実行要求（許可判定・シェルを介さない実行・完了判定・標準入力・タイムアウト）の受け入れテスト。
// 受け入れ条件 runner/AC-1〜AC-5・AC-14・AC-16 を、実HTTPサーバ（一時ポート）に対する要求で確認する。

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, request, type Server } from "node:http";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleExec } from "../../proxy/src/exec/exec-handler.js";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-accept-runner-"));
const markerFile = join(dir, "other-binary-ran");

/** 目的: 実行可能なシェルスクリプトを作成し、そのパスを返す。 */
function makeScript(name: string, lines: string[]): string {
  const path = join(dir, name);
  writeFileSync(path, ["#!/bin/sh", ...lines].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

// 許可バイナリ: 引数を1行ずつ出力し、標準入力の1行を読む。サブコマンドで挙動を切り替える。
const allowedScript = makeScript("vendor-cli.sh", [
  'case "$1" in',
  '  daemon) (sleep 3 &) ; echo started ; exit 0 ;;',
  '  url) echo "open https://example.test/auth/abc123 now" ; sleep 3 ; exit 0 ;;',
  "  hang) sleep 5 ; exit 0 ;;",
  '  secret) read -r line ; echo "received" ; exit 0 ;;',
  "esac",
  'for a in "$@"; do echo "arg=$a"; done',
]);
// 許可されないバイナリ: 実行されたら目印のファイルを作る。
const otherScript = makeScript("other-cli.sh", [`touch ${markerFile}`, "echo ran"]);

let server: Server;
let port: number;

beforeAll(async () => {
  process.env.RUNNER_ALLOWED_BINARY = allowedScript;
  server = createServer((req, res) => void handleExec(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  delete process.env.RUNNER_ALLOWED_BINARY;
  server.close();
});

// 監査ログ（標準出力）を各テストで捕捉する。標準出力を汚さず、AC-5で内容を検査できるようにする。
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 目的: POST /exec を送り、ステータスとJSON本文を返す。 */
function post(body: string): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/exec", method: "POST" }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk.toString("utf8")));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(data) as Record<string, unknown> }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const validBody = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ vendor: "v", binary: allowedScript, resolvedArgv: ["status"], timeoutMs: 5000, ...overrides });

describe("ランナーの実行要求", () => {
  it("runner/AC-1: 許可バイナリ以外を指定した要求は403で拒否され、プロセスが起動しない", async () => {
    const { status, json } = await post(validBody({ binary: otherScript }));
    expect(status).toBe(403);
    expect(json).toEqual({ error: "binary_not_allowed" });
    expect(existsSync(markerFile)).toBe(false);
  });

  it("runner/AC-2: セミコロンを含む引数は、分割も解釈もされず1つの引数として渡る", async () => {
    const { status, json } = await post(validBody({ resolvedArgv: ["a;touch /tmp/pwned", "$(id)", "`id`"] }));
    expect(status).toBe(200);
    expect(String(json.stdout).split("\n").filter(Boolean)).toEqual(["arg=a;touch /tmp/pwned", "arg=$(id)", "arg=`id`"]);
  });

  it("runner/AC-3: 孫プロセスが出力を保持したまま親が終了しても、親の終了で応答が返る", async () => {
    const started = Date.now();
    const { status, json } = await post(validBody({ resolvedArgv: ["daemon"] }));
    expect(status).toBe(200);
    expect(json).toMatchObject({ exitCode: 0 });
    // 孫プロセス（3秒）の終了を待たずに返る。
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it("runner/AC-4: 出力が指定パターンに一致すると、プロセスの終了を待たず終了コードなしで応答する", async () => {
    const started = Date.now();
    const { status, json } = await post(
      validBody({ resolvedArgv: ["url"], completionPattern: "https://example\\.test/auth/[a-z0-9]+" }),
    );
    expect(status).toBe(200);
    expect(json.exitCode).toBeNull();
    expect(String(json.stdout)).toContain("https://example.test/auth/abc123");
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it("runner/AC-5: 標準入力を渡した要求の監査ログに、入力内容が含まれず有無だけが記録される", async () => {
    const { status } = await post(validBody({ resolvedArgv: ["secret"], stdin: "TOP-SECRET-PASSWORD\n" }));
    expect(status).toBe(200);
    expect(logged.join("\n")).not.toContain("TOP-SECRET-PASSWORD");
    const completed = logged.map((line) => JSON.parse(line) as Record<string, unknown>).find((e) => e.event === "exec_completed");
    expect(completed).toMatchObject({ stdinProvided: true });
  });

  it("runner/AC-14: 4097バイトの標準入力を含む要求は、形状不正の400で拒否される", async () => {
    const { status, json } = await post(validBody({ stdin: "x".repeat(4097) }));
    expect(status).toBe(400);
    expect(json).toEqual({ error: "invalid_request_shape" });
    // 上限ちょうど（4096バイト）は受理される。
    expect((await post(validBody({ resolvedArgv: ["secret"], stdin: "x".repeat(4096) }))).status).toBe(200);
  });

  it("runner/AC-16: 指定時間を超えたプロセスは、終了コード-1で応答される", async () => {
    const { status, json } = await post(validBody({ resolvedArgv: ["hang"], timeoutMs: 300 }));
    expect(status).toBe(200);
    expect(json.exitCode).toBe(-1);
  });
});
