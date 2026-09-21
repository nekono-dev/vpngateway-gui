// 責務: POST /v1/session（ログイン代行）のAPIエンドポイント統合テスト。
// プロキシとの実通信（UDS経由）はproxy-clientモジュールをモックし、Fastifyアプリ全体
// （ルーティング・エラーハンドラ）を通した挙動を検証する（specs/apiserver/tasks.md「将来課題」参照）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "adguardvpn";
process.env.STATE_DIR = dir;
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");

const { executeVendorCommandMock } = vi.hoisted(() => ({
  executeVendorCommandMock: vi.fn(),
}));

// 第1引数を入力、第2引数をベンダーIDとして記録する（呼び出し内容の検証を、入力を先頭にして書けるようにするため）。
vi.mock("../proxy-client/proxy-client.js", () => ({
  executeVendorCommand: (providerId: string, input: unknown) => executeVendorCommandMock(input, providerId),
  requestConnectionCheck: async () => true,
  checkRunnerHealth: async () => true,
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

describe("GET/DELETE /v1/session と capabilities（URL提示型・AdGuard VPNプロファイル）", () => {
  const LICENSE_PREMIUM = "Logged in as user@example.com\nYou are using the \x1B[1mPREMIUM\x1B[0m version\nUp to 10 devices simultaneously";
  const LICENSE_LOGGED_OUT = "Please log in to view your license info\nYou can log in by running `adguardvpn-cli login`";

  beforeEach(async () => {
    executeVendorCommandMock.mockReset();
    const { invalidateSessionInfo } = await import("../session/session-probe.js");
    const { clearLearnedRestrictions } = await import("../capabilities/restriction-learner.js");
    invalidateSessionInfo("adguardvpn");
    clearLearnedRestrictions("adguardvpn");
  });

  it("GET /v1/session: licenseの出力からログイン状態・プランを判定して返す（実機のPREMIUM出力）", async () => {
    executeVendorCommandMock.mockResolvedValue({ exitCode: 0, stdout: LICENSE_PREMIUM, stderr: "" });
    const response = await buildApp().inject({ method: "GET", url: "/v1/session" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ loginMethod: "deviceUrl", loggedIn: true, plan: { id: "premium", label: "Premium" } });
    expect(executeVendorCommandMock.mock.calls[0][0].resolvedArgv).toEqual(["license"]);
  });

  it("GET /v1/session: 未ログインは終了コード11でもloggedIn=false（実機の未ログイン出力）", async () => {
    executeVendorCommandMock.mockResolvedValue({ exitCode: 11, stdout: LICENSE_LOGGED_OUT, stderr: "" });
    const response = await buildApp().inject({ method: "GET", url: "/v1/session" });
    expect(response.json()).toEqual({ loginMethod: "deviceUrl", loggedIn: false });
  });

  it("ボディがnull（生成クライアントがボディ引数にnullを渡す場合）でも、URL提示型のログインができる", async () => {
    executeVendorCommandMock.mockResolvedValue({
      exitCode: null,
      stdout: "https://auth.adguard.io/device_code?user_code=ABCD",
      stderr: "",
    });
    const response = await buildApp().inject({
      method: "POST",
      url: "/v1/session",
      headers: { "content-type": "application/json" },
      payload: "null",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().loginUrl).toBe("https://auth.adguard.io/device_code?user_code=ABCD");
  });

  it("DELETE /v1/session: logoutアクションを実行し、成功するとキャッシュしたログイン状態を破棄する", async () => {
    executeVendorCommandMock.mockResolvedValueOnce({ exitCode: 0, stdout: LICENSE_PREMIUM, stderr: "" });
    const app = buildApp();
    await app.inject({ method: "GET", url: "/v1/session" });
    executeVendorCommandMock.mockResolvedValueOnce({ exitCode: 0, stdout: "Logged out\n", stderr: "" });
    const response = await app.inject({ method: "DELETE", url: "/v1/session" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "Logged out" });
    expect(executeVendorCommandMock.mock.calls[1][0].resolvedArgv).toEqual(["logout"]);
    // 破棄されているので、次の取得はキャッシュではなく再判定する。
    executeVendorCommandMock.mockResolvedValueOnce({ exitCode: 11, stdout: LICENSE_LOGGED_OUT, stderr: "" });
    expect((await app.inject({ method: "GET", url: "/v1/session" })).json().loggedIn).toBe(false);
  });

  it("GET /v1/connection/capabilities: 非対応（connectAuto）だけがunsupported、他は可（従来どおりの操作が塞がらない）", async () => {
    executeVendorCommandMock.mockResolvedValue({ exitCode: 0, stdout: LICENSE_PREMIUM, stderr: "" });
    const response = await buildApp().inject({ method: "GET", url: "/v1/connection/capabilities" });
    const { capabilities } = response.json();
    expect(capabilities.connectAuto).toMatchObject({ available: false, reason: "unsupported" });
    for (const key of ["login", "logout", "connectToLocation", "changeLocation", "disconnect", "locationList", "locationFavorites", "pingMeasurement"]) {
      expect(capabilities[key]).toEqual({ available: true });
    }
  });

  it("未ログインなら接続系がnotLoggedInになる", async () => {
    executeVendorCommandMock.mockResolvedValue({ exitCode: 11, stdout: LICENSE_LOGGED_OUT, stderr: "" });
    const { capabilities } = (await buildApp().inject({ method: "GET", url: "/v1/connection/capabilities" })).json();
    expect(capabilities.connectToLocation).toMatchObject({ available: false, reason: "notLoggedIn" });
    expect(capabilities.locationList).toMatchObject({ available: false, reason: "notLoggedIn" });
    expect(capabilities.login).toEqual({ available: true });
  });
});
