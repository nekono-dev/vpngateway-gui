// 責務: ランナーの`POST /exec`（exec-handler.ts）の単体テスト。実HTTPサーバ（一時ポート）に対して、
// 許可リスト（自ベンダーのバイナリのみ）・入力検証・stdinの受け渡しを確認する。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, request, type Server } from "node:http";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { handleExec, isValidExecRequestBody } from "./exec-handler.js";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
const allowedScript = join(dir, "vendor-cli.sh");
writeFileSync(allowedScript, ["#!/bin/sh", "read -r line", 'echo "args=$* stdin=$line"', "exit 0"].join("\n"));
chmodSync(allowedScript, 0o755);

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

/** POST /exec を送り、ステータスとJSON本文を返す。 */
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
  JSON.stringify({ vendor: "v", binary: allowedScript, resolvedArgv: ["status"], timeoutMs: 3000, ...overrides });

describe("POST /exec（ランナー）", () => {
  it("自ベンダーのバイナリは実行し、終了コード・標準出力を返す", async () => {
    const { status, json } = await post(validBody());
    expect(status).toBe(200);
    expect(json).toMatchObject({ exitCode: 0 });
    expect(String(json.stdout)).toContain("args=status");
  });

  it("stdinを子プロセスの標準入力へ渡す", async () => {
    const { json } = await post(validBody({ stdin: "secret\n" }));
    expect(String(json.stdout)).toContain("stdin=secret");
  });

  it("許可リスト外（別ベンダーのバイナリ・シェル）は403で、実行しない", async () => {
    expect((await post(validBody({ binary: "/usr/local/bin/adguardvpn-cli" }))).status).toBe(403);
    expect((await post(validBody({ binary: "/bin/sh", resolvedArgv: ["-c", "echo pwned"] }))).status).toBe(403);
  });

  it("JSON不正・形状不正は400", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ vendor: "v" }))).status).toBe(400);
  });

  it("4096バイトを超えるstdinは400", async () => {
    expect((await post(validBody({ stdin: "x".repeat(4097) }))).status).toBe(400);
  });
});

describe("isValidExecRequestBody", () => {
  it("最小要件（vendor・binary・resolvedArgv・timeoutMs）を満たせば true", () => {
    expect(isValidExecRequestBody({ vendor: "v", binary: "/b", resolvedArgv: [], timeoutMs: 1 })).toBe(true);
  });

  it("timeoutMsが0以下・argvに文字列以外があれば false", () => {
    expect(isValidExecRequestBody({ vendor: "v", binary: "/b", resolvedArgv: [], timeoutMs: 0 })).toBe(false);
    expect(isValidExecRequestBody({ vendor: "v", binary: "/b", resolvedArgv: [1], timeoutMs: 1 })).toBe(false);
  });
});
