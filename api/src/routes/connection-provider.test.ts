// 責務: プロバイダ抽象化（Phase 9）に関するAPIの統合テスト（プロキシ通信はモック）。
// Proton VPN相当（無料版のモックCLI）のプロファイルで、接続先を指定しない接続（connectAuto）、
// プラン制限（403）の学習とcapabilityへの反映、非対応操作（501）、ログイン・ログアウト、
// 秘密情報（パスワード・2FAコード）が応答・監査ログへ残らないことを検証する。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
process.env.VPN_PROFILES_DIR = join(import.meta.dirname, "../../test-fixtures/profiles");
process.env.ENABLED_PROVIDERS = "mockproton";
process.env.STATE_DIR = dir;
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");

const { executeVendorCommandMock } = vi.hoisted(() => ({ executeVendorCommandMock: vi.fn() }));
// 第1引数を入力、第2引数をベンダーIDとして記録する（呼び出し内容の検証を、入力を先頭にして書けるようにするため）。
vi.mock("../proxy-client/proxy-client.js", () => ({
  executeVendorCommand: (providerId: string, input: unknown) => executeVendorCommandMock(input, providerId),
  requestConnectionCheck: async () => true,
  checkRunnerHealth: async () => true,
}));

const { buildApp } = await import("../app.js");
const { invalidateSessionInfo } = await import("../session/session-probe.js");
const { clearLearnedRestrictions } = await import("../capabilities/restriction-learner.js");

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
const fail = (exitCode: number, stderr: string, stdout = "") => ({ exitCode, stdout, stderr });
/** 実行されたコマンドのうち、`signin`（ログイン）のものだけを返す（他のテスト準備の実行と区別するため）。 */
const signinCalls = () =>
  executeVendorCommandMock.mock.calls.map(([input]) => input).filter((input) => input.resolvedArgv[0] === "signin");

const FREE_CONFIG = "Setting  Value\nnetshield  Upgrade to enable\nTo upgrade to VPN Plus visit: https://account.protonvpn.com/pricing";
const PAID_CONFIG = "Setting  Value\nnetshield  off\nUse 'protonvpn config set <setting> <value>' to change settings.";
const NOT_LOGGED_IN = fail(2, "Error: Authentication required to view feature status. Please sign in with 'protonvpn signin'");
const COUNTRIES = "Country          Code\n---------------  ------\nJapan            JP\nUnited States    US\n";
const FREE_LIMIT = "Error: Location selection is not available on the free plan. Please use 'protonvpn connect' to connect to available free servers or upgrade to choose your location.";

// 実行されたサブコマンドごとに、CLIの応答を返す。`state`で無料/有料・ログイン状態を切り替える。
const state = { plan: "free" as "free" | "paid", loggedIn: true, connectedTo: undefined as string | undefined };
function fakeProton({ resolvedArgv }: { resolvedArgv: string[] }) {
  const [command, ...rest] = resolvedArgv;
  if (command === "config") return Promise.resolve(state.loggedIn ? ok(state.plan === "free" ? FREE_CONFIG : PAID_CONFIG) : NOT_LOGGED_IN);
  if (command === "status") {
    return Promise.resolve(ok(state.connectedTo ? `Status: Connected\nServer: ${state.connectedTo}\nLoad: 30%\nProtocol: wireguard-udp` : "Status: Disconnected"));
  }
  if (command === "countries") return Promise.resolve(ok(COUNTRIES));
  if (command === "connect") {
    if (rest.length > 0 && state.plan === "free") return Promise.resolve(fail(2, FREE_LIMIT));
    state.connectedTo = rest.length > 0 ? "JP#1 in Tokyo, Japan" : "JP-FREE#5 in Tokyo, Japan";
    return Promise.resolve(ok(`Connected to ${state.connectedTo}. \nYour new IP address is 1.2.3.4.`));
  }
  if (command === "disconnect") {
    state.connectedTo = undefined;
    return Promise.resolve(ok("Disconnected."));
  }
  if (command === "signin") return Promise.resolve(ok("Successfully signed in as 'user@proton.me'"));
  if (command === "signout") return Promise.resolve(ok("You have been successfully signed out."));
  return Promise.resolve(fail(1, `unexpected command: ${command}`));
}

describe("プロバイダ抽象化（Proton VPN相当・無料/有料）", () => {
  const app = buildApp();

  beforeEach(async () => {
    executeVendorCommandMock.mockReset();
    executeVendorCommandMock.mockImplementation(fakeProton);
    state.plan = "free";
    state.loggedIn = true;
    state.connectedTo = undefined;
    invalidateSessionInfo("mockproton");
    clearLearnedRestrictions("mockproton");
    rmSync(process.env.AUDIT_LOG_FILE!, { force: true });
    await app.inject({ method: "GET", url: "/v1/connection" }); // 切断観測で保存内容を初期化
  });

  describe("GET /v1/connection/capabilities", () => {
    it("無料版: 接続先の指定・一覧が理由付きで無効、自動接続は可", async () => {
      const { capabilities } = (await app.inject({ method: "GET", url: "/v1/connection/capabilities" })).json();
      expect(capabilities.connectToLocation).toMatchObject({ available: false, reason: "planRestricted" });
      expect(capabilities.connectToLocation.message).toContain("無料プラン");
      expect(capabilities.locationList).toMatchObject({ available: false, reason: "planRestricted" });
      expect(capabilities.locationFavorites).toMatchObject({ available: false, reason: "planRestricted" });
      expect(capabilities.connectAuto).toEqual({ available: true });
      expect(capabilities.disconnect).toEqual({ available: true });
    });

    it("有料版: 接続先の指定・一覧が可。pingはプロバイダ非対応", async () => {
      state.plan = "paid";
      const { capabilities } = (await app.inject({ method: "GET", url: "/v1/connection/capabilities" })).json();
      expect(capabilities.connectToLocation).toEqual({ available: true });
      expect(capabilities.locationList).toEqual({ available: true });
      expect(capabilities.pingMeasurement).toMatchObject({ available: false, reason: "unsupported" });
    });

    it("未ログイン: 接続系がnotLoggedIn", async () => {
      state.loggedIn = false;
      const { capabilities } = (await app.inject({ method: "GET", url: "/v1/connection/capabilities" })).json();
      expect(capabilities.connectAuto).toMatchObject({ available: false, reason: "notLoggedIn", message: "ログインしてください" });
      expect(capabilities.login).toEqual({ available: true });
    });

    it("判定コマンドが失敗（プロキシ未応答）でも200で、制限をかけない", async () => {
      executeVendorCommandMock.mockRejectedValue(new Error("proxy down"));
      const response = await app.inject({ method: "GET", url: "/v1/connection/capabilities" });
      expect(response.statusCode).toBe(200);
      expect(response.json().capabilities.connectToLocation.available).toBe(true);
    });
  });

  describe("PUT /v1/connection（接続先を指定しない接続）", () => {
    it("locationIdなしでconnectAutoを実行し、接続先IDは保存せず（locationIdなし）、locationはCLI出力から返す", async () => {
      const response = await app.inject({ method: "PUT", url: "/v1/connection", payload: { connect: true } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "connected", location: "JP-FREE#5 in Tokyo, Japan" });
      const argvs = executeVendorCommandMock.mock.calls.map(([input]) => input.resolvedArgv);
      expect(argvs).toContainEqual(["connect"]);
      // 最後の接続先は更新しない（自動接続では接続先が分からないため）。
      const reloaded = await buildApp().inject({ method: "GET", url: "/v1/connection" });
      expect(reloaded.json()).toEqual({ status: "connected", location: "JP-FREE#5 in Tokyo, Japan" });
    });

    it("切断（connect=false）は従来どおり実行できる", async () => {
      await app.inject({ method: "PUT", url: "/v1/connection", payload: { connect: true } });
      const response = await app.inject({ method: "PUT", url: "/v1/connection", payload: { connect: false } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "disconnected" });
    });
  });

  describe("プラン制限の学習（403）", () => {
    it("無料版で接続先を指定すると、CLIの失敗が403 operation_restrictedになり、以後capabilityがplanRestrictedになる", async () => {
      state.plan = "paid"; // accountの判定は有料と誤っている（判定できていない）状況を再現する。
      // 一覧は取得できるが、接続時にCLIが無料版の制限で失敗する。
      executeVendorCommandMock.mockImplementation(({ resolvedArgv }: { resolvedArgv: string[] }) => {
        if (resolvedArgv[0] === "connect" && resolvedArgv.length > 1) return Promise.resolve(fail(2, FREE_LIMIT));
        return fakeProton({ resolvedArgv });
      });
      const put = await app.inject({ method: "PUT", url: "/v1/connection", payload: { connect: true, locationId: "jp-japan" } });
      expect(put.statusCode).toBe(403);
      expect(put.json()).toMatchObject({ error: "operation_restricted", exitCode: 2 });
      expect(put.json().stderr).toContain("not available on the free plan");

      const { capabilities } = (await app.inject({ method: "GET", url: "/v1/connection/capabilities" })).json();
      expect(capabilities.connectToLocation).toMatchObject({ available: false, reason: "planRestricted" });
    });

    it("プラン制限に当たらない通常の失敗は422のまま、学習もしない", async () => {
      executeVendorCommandMock.mockImplementation(({ resolvedArgv }: { resolvedArgv: string[] }) =>
        resolvedArgv[0] === "connect" ? Promise.resolve(fail(1, "Connection failed. Try connecting to a different server.")) : fakeProton({ resolvedArgv }),
      );
      const put = await app.inject({ method: "PUT", url: "/v1/connection", payload: { connect: true } });
      expect(put.statusCode).toBe(422);
      state.plan = "paid";
      invalidateSessionInfo("mockproton");
      const { capabilities } = (await app.inject({ method: "GET", url: "/v1/connection/capabilities" })).json();
      expect(capabilities.connectAuto.available).toBe(true);
    });

    it("ログイン・ログアウトの成功で学習した制限が解除される", async () => {
      state.plan = "paid";
      executeVendorCommandMock.mockImplementation(({ resolvedArgv }: { resolvedArgv: string[] }) =>
        resolvedArgv[0] === "countries" ? Promise.resolve(fail(2, FREE_LIMIT)) : fakeProton({ resolvedArgv }),
      );
      expect((await app.inject({ method: "GET", url: "/v1/connection/locations" })).statusCode).toBe(403);
      let caps = (await app.inject({ method: "GET", url: "/v1/connection/capabilities" })).json().capabilities;
      expect(caps.locationList.available).toBe(false);
      // 一覧を取得できないなら接続先を解決できないため、接続先の指定も実行不可になる。
      expect(caps.connectToLocation).toMatchObject({ available: false, reason: "planRestricted" });

      await app.inject({ method: "DELETE", url: "/v1/session" });
      caps = (await app.inject({ method: "GET", url: "/v1/connection/capabilities" })).json().capabilities;
      expect(caps.locationList.available).toBe(true);
      expect(caps.connectToLocation.available).toBe(true);
    });
  });

  describe("接続先一覧（国単位）", () => {
    it("有料版: 国一覧をcityなしで返し、国コードで接続する（--country JP）", async () => {
      state.plan = "paid";
      const list = await app.inject({ method: "GET", url: "/v1/connection/locations" });
      expect(list.json()).toEqual([
        { id: "jp-japan", country: "jp", countryName: "Japan", favorite: false, lastConnected: false },
        { id: "us-united-states", country: "us", countryName: "United States", favorite: false, lastConnected: false },
      ]);
      const put = await app.inject({ method: "PUT", url: "/v1/connection", payload: { connect: true, locationId: "jp-japan" } });
      expect(put.statusCode).toBe(200);
      const connectCall = executeVendorCommandMock.mock.calls.map(([input]) => input.resolvedArgv).find((argv) => argv[0] === "connect");
      expect(connectCall).toEqual(["connect", "--country", "JP"]);
      expect(put.json()).toMatchObject({ status: "connected", country: "jp", locationId: "jp-japan" });
    });
  });

  describe("セッション", () => {
    it("GET /v1/session: ログイン方式・ログイン状態・プランを返す", async () => {
      expect((await app.inject({ method: "GET", url: "/v1/session" })).json()).toEqual({
        loginMethod: "credentials",
        loggedIn: true,
        plan: { id: "free", label: "Free" },
      });
      state.loggedIn = false;
      invalidateSessionInfo("mockproton");
      expect((await app.inject({ method: "GET", url: "/v1/session" })).json()).toEqual({ loginMethod: "credentials", loggedIn: false });
    });

    it("POST /v1/session（credentials）: パスワード・2FAを標準入力にのみ渡し、監査ログ・応答に残さない", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/session",
        payload: { username: "user@proton.me", password: "hunter2-secret", twoFactorCode: "654321" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ message: "ログインしました。" });

      const call = executeVendorCommandMock.mock.calls.map(([input]) => input).find((input) => input.resolvedArgv[0] === "signin");
      expect(call.resolvedArgv).toEqual(["signin", "user@proton.me"]);
      expect(call.stdin).toBe("hunter2-secret\n654321\n");
      // 秘密は引数（プロセス一覧に見える）にも、監査ログにも現れない。
      expect(JSON.stringify(call.resolvedArgv)).not.toContain("hunter2-secret");
      const audit = readFileSync(process.env.AUDIT_LOG_FILE!, "utf8");
      expect(audit).toContain("user@proton.me");
      expect(audit).not.toContain("hunter2-secret");
      expect(audit).not.toContain("654321");
    });

    it("2FAコードなしなら標準入力はパスワードの1行のみ", async () => {
      await app.inject({ method: "POST", url: "/v1/session", payload: { username: "user@proton.me", password: "pw" } });
      const call = executeVendorCommandMock.mock.calls.map(([input]) => input).find((input) => input.resolvedArgv[0] === "signin");
      expect(call.stdin).toBe("pw\n");
    });

    it("ログイン失敗（422）: CLIが入力を出力へ反映しても、応答のstderrでは伏字になる", async () => {
      executeVendorCommandMock.mockResolvedValue(fail(1, "Error: Authentication failed for password hunter2-secret. Please check your username and password."));
      const response = await app.inject({
        method: "POST",
        url: "/v1/session",
        payload: { username: "user@proton.me", password: "hunter2-secret" },
      });
      expect(response.statusCode).toBe(422);
      expect(response.body).not.toContain("hunter2-secret");
      expect(response.json().stderr).toContain("password ***");
    });

    it("ボディ無しのログイン（credentials方式）は400", async () => {
      const response = await app.inject({ method: "POST", url: "/v1/session" });
      expect(response.statusCode).toBe(400);
      expect(signinCalls()).toHaveLength(0);
    });

    it("パスワードに改行を含むと400で、CLIは実行されない（標準入力への行の混入を防ぐ）", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/session",
        payload: { username: "user@proton.me", password: "pw\n123456" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain("123456");
      expect(signinCalls()).toHaveLength(0);
    });

    it("ユーザー名がオプション形式（-で始まる）だと400", async () => {
      const response = await app.inject({ method: "POST", url: "/v1/session", payload: { username: "--help", password: "pw" } });
      expect(response.statusCode).toBe(400);
      expect(signinCalls()).toHaveLength(0);
    });

    it("DELETE /v1/session: ログアウトし、保存した接続先を消す", async () => {
      const response = await app.inject({ method: "DELETE", url: "/v1/session" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ message: "You have been successfully signed out." });
      const argvs = executeVendorCommandMock.mock.calls.map(([input]) => input.resolvedArgv);
      expect(argvs).toContainEqual(["signout"]);
    });
  });
});
