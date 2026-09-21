// 責務: POST /v1/session（ログイン代行）のAPIエンドポイント統合テスト。
// プロキシとの実通信（UDS経由）はproxy-clientモジュールをモックし、Fastifyアプリ全体
// （ルーティング・エラーハンドラ）を通した挙動を検証する（specs/apiserver/tasks.md「将来課題」参照）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

process.env.VPN_PROFILE_PATH = join(import.meta.dirname, "../../config/vpn-profile.json");
process.env.AUDIT_LOG_FILE = join(mkdtempSync(join(tmpdir(), "vpngwgui-test-")), "audit.log");

const { executeVendorCommandMock } = vi.hoisted(() => ({
  executeVendorCommandMock: vi.fn(),
}));

vi.mock("../proxy-client/proxy-client.js", () => ({
  executeVendorCommand: executeVendorCommandMock,
}));

const { buildApp } = await import("../app.js");

describe("POST /v1/session", () => {
  beforeEach(() => {
    executeVendorCommandMock.mockReset();
  });

  it("completionPatternに一致した場合、200でloginUrlとメッセージを返す", async () => {
    executeVendorCommandMock.mockResolvedValue({
      exitCode: null,
      stdout: "You need to authorize in your browser: https://auth.adguard.io/device_code?user_code=ABCD",
      stderr: "",
    });

    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/session" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      loginUrl: "https://auth.adguard.io/device_code?user_code=ABCD",
      message: "表示されたURLをブラウザで開いてログインを完了してください。",
    });
  });

  it("既にログイン済みで即座に正常終了した場合、stdoutをメッセージとして200を返す", async () => {
    executeVendorCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: "You are already logged in as user@example.com",
      stderr: "",
    });

    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/session" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "You are already logged in as user@example.com" });
  });

  it("失敗時にstderrが空ならstdoutを診断として返す（実CLIはエラーをstdoutへ出力する）", async () => {
    executeVendorCommandMock.mockResolvedValue({
      exitCode: 14,
      stdout: "Failed to disconnect. Process is not running\n",
      stderr: "",
    });

    const response = await buildApp().inject({ method: "POST", url: "/v1/session" });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ exitCode: 14, stderr: "Failed to disconnect. Process is not running" });
  });

  it("コマンドが失敗した場合、422でexitCode/stderrを返す", async () => {
    executeVendorCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "network error",
    });

    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/session" });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "command_failed", exitCode: 1, stderr: "network error" });
  });

  it("プロキシへの接続に失敗した場合、502を返す", async () => {
    const { ProxyUnavailableError } = await import("../errors.js");
    executeVendorCommandMock.mockRejectedValue(new ProxyUnavailableError("failed to connect to proxy control socket"));

    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/session" });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: "proxy_unavailable" });
  });

  it("プロキシの応答がタイムアウトした場合、504を返す", async () => {
    const { ProxyTimeoutError } = await import("../errors.js");
    executeVendorCommandMock.mockRejectedValue(new ProxyTimeoutError("proxy did not respond within timeout"));

    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/session" });

    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({ error: "proxy_timeout" });
  });
});
