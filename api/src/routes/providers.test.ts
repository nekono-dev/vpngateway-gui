// 責務: GET /v1/providers・PUT /v1/providers/active（ベンダーの一覧と切替）の統合テスト。
// 2ベンダー（AdGuard VPN・モックProton）を有効にし、ランナーの利用可否・接続中の切替（確認→自動切断）・切断失敗時の
// 中止・切替中の409・ベンダー別の状態の独立・ネットワークコンテナへの再確認通知を検証する（プロキシ通信はモック）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "vpngwgui-switch-"));
const profilesDir = join(root, "profiles");
mkdirSync(profilesDir);
copyFileSync(join(import.meta.dirname, "../../config/profiles/adguardvpn.json"), join(profilesDir, "adguardvpn.json"));
copyFileSync(join(import.meta.dirname, "../../test-fixtures/profiles/mockproton.json"), join(profilesDir, "mockproton.json"));
process.env.VPN_PROFILES_DIR = profilesDir;
process.env.ENABLED_PROVIDERS = "adguardvpn,mockproton";
process.env.STATE_DIR = root;
process.env.AUDIT_LOG_FILE = join(root, "audit.log");

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  health: vi.fn(),
  check: vi.fn(),
}));
vi.mock("../proxy-client/proxy-client.js", () => ({
  executeVendorCommand: (providerId: string, input: unknown) => mocks.execute(providerId, input),
  checkRunnerHealth: (providerId: string) => mocks.health(providerId),
  requestConnectionCheck: () => mocks.check(),
}));

const { buildApp } = await import("../app.js");
const { saveActiveProviderId, getActiveProvider } = await import("../providers/active-provider-store.js");
const { saveConnectedLocation, reconcileLocation } = await import("../connection-state/connection-state-store.js");
const { ProxyUnavailableError } = await import("../errors.js");

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
const ADGUARD_CONNECTED = "Connected to \x1B[1mTOKYO\x1B[0m in \x1B[1mTUN\x1B[0m mode, running on \x1B[1mtun0\x1B[0m";

// ベンダーごとの状態（接続中か）を持つ模擬ランナー。
const state = { adguardConnected: true, disconnectFails: false, healthy: { adguardvpn: true, mockproton: true } as Record<string, boolean> };
function fakeRunner(providerId: string, input: { resolvedArgv: string[] }) {
  const command = input.resolvedArgv[0];
  if (providerId === "adguardvpn") {
    if (command === "status") return Promise.resolve(ok(state.adguardConnected ? ADGUARD_CONNECTED : "VPN is disconnected"));
    if (command === "disconnect") {
      if (state.disconnectFails) return Promise.resolve({ exitCode: 1, stdout: "Failed to disconnect", stderr: "" });
      state.adguardConnected = false;
      return Promise.resolve(ok("VPN stopped"));
    }
  }
  if (providerId === "mockproton" && command === "status") return Promise.resolve(ok("Status: Disconnected"));
  return Promise.resolve(ok(""));
}

describe("ベンダーの一覧と切替", () => {
  const app = buildApp();

  beforeEach(() => {
    state.adguardConnected = true;
    state.disconnectFails = false;
    state.healthy = { adguardvpn: true, mockproton: true };
    mocks.execute.mockReset();
    mocks.execute.mockImplementation(fakeRunner);
    mocks.health.mockReset();
    mocks.health.mockImplementation((id: string) => Promise.resolve(state.healthy[id]));
    mocks.check.mockReset();
    mocks.check.mockResolvedValue(true);
    saveActiveProviderId("adguardvpn");
  });

  it("GET /v1/providers: 有効化された順に、選択中・利用可否（ランナーの応答）を返す", async () => {
    state.healthy.mockproton = false;
    const response = await app.inject({ method: "GET", url: "/v1/providers" });
    expect(response.json()).toEqual([
      { id: "adguardvpn", displayName: "AdGuard VPN", active: true, available: true },
      { id: "mockproton", displayName: "Proton VPN（モック）", active: false, available: false, unavailableReason: "ランナーが起動していません" },
    ]);
  });

  it("接続中に切り替えると、現在のベンダーを切断してから選択を更新し、再確認を通知する", async () => {
    const response = await app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "mockproton" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: "mockproton", displayName: "Proton VPN（モック）" });
    expect(state.adguardConnected).toBe(false);
    expect(mocks.execute.mock.calls.map(([id, input]) => `${id}:${input.resolvedArgv[0]}`)).toEqual(["adguardvpn:status", "adguardvpn:disconnect"]);
    expect(getActiveProvider().id).toBe("mockproton");
    expect(mocks.check).toHaveBeenCalledTimes(1);
    const audit = readFileSync(process.env.AUDIT_LOG_FILE!, "utf8");
    expect(audit).toContain('"action":"switch-provider"');
    expect(audit).toContain('"provider":"adguardvpn"'); // 切断の記録（切断したベンダー）
  });

  it("接続していなければ切断せずに切り替える", async () => {
    state.adguardConnected = false;
    const response = await app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "mockproton" } });
    expect(response.statusCode).toBe(200);
    expect(mocks.execute.mock.calls.map(([, input]) => input.resolvedArgv[0])).toEqual(["status"]);
  });

  it("切断に失敗したら422で切り替えず、選択は元のまま", async () => {
    state.disconnectFails = true;
    const response = await app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "mockproton" } });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: "command_failed", stderr: "Failed to disconnect" });
    expect(getActiveProvider().id).toBe("adguardvpn");
  });

  it("現在のランナーが応答しない場合は、切断できないが切替は許可する（止まったランナーに縛られない）", async () => {
    mocks.execute.mockRejectedValue(new ProxyUnavailableError("down"));
    const response = await app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "mockproton" } });
    expect(response.statusCode).toBe(200);
    expect(getActiveProvider().id).toBe("mockproton");
  });

  it("切替先のランナーが利用不可なら502で切り替えない（切断もしない）", async () => {
    state.healthy.mockproton = false;
    const response = await app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "mockproton" } });
    expect(response.statusCode).toBe(502);
    expect(getActiveProvider().id).toBe("adguardvpn");
    expect(state.adguardConnected).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("未知・無効なID、形式不正なIDは400", async () => {
    expect((await app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "nordvpn" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "../x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/v1/providers/active", payload: {} })).statusCode).toBe(400);
  });

  it("選択中と同じベンダーへの切替は何もしない（200）", async () => {
    const response = await app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "adguardvpn" } });
    expect(response.statusCode).toBe(200);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(state.adguardConnected).toBe(true);
  });

  it("切替中に来たベンダーへの変更操作は409（provider_switching）。読み取りは影響しない", async () => {
    // 切断コマンドの完了を止めて、切替を進行中の状態にする。
    let release: () => void = () => {};
    mocks.execute.mockImplementation((id: string, input: { resolvedArgv: string[] }) => {
      if (id === "adguardvpn" && input.resolvedArgv[0] === "disconnect") {
        return new Promise((resolve) => {
          release = () => resolve(ok("VPN stopped"));
        });
      }
      return fakeRunner(id, input);
    });
    const switching = app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "mockproton" } });
    await vi.waitFor(() => expect(mocks.execute.mock.calls.some(([, input]) => input.resolvedArgv[0] === "disconnect")).toBe(true));

    expect((await app.inject({ method: "PUT", url: "/v1/connection", payload: { connect: false } })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: "/v1/session" })).statusCode).toBe(409);
    expect((await app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "mockproton" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: "/v1/providers" })).statusCode).toBe(200);

    release();
    expect((await switching).statusCode).toBe(200);
    // 切替が終われば他の操作は再び可能。
    expect((await app.inject({ method: "PUT", url: "/v1/connection", payload: { connect: false } })).statusCode).toBe(200);
  });

  it("既存の操作は選択中のベンダーに作用し、切り替えるとそのベンダーのランナー・プロファイルが使われる", async () => {
    await app.inject({ method: "GET", url: "/v1/connection" });
    expect(mocks.execute.mock.calls.at(-1)![0]).toBe("adguardvpn");
    await app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "mockproton" } });
    mocks.execute.mockClear();
    const status = await app.inject({ method: "GET", url: "/v1/connection" });
    expect(mocks.execute.mock.calls[0][0]).toBe("mockproton");
    expect(status.json()).toEqual({ status: "disconnected" });
    const session = await app.inject({ method: "GET", url: "/v1/session" });
    expect(session.json().loginMethod).toBe("credentials");
  });

  it("接続先の保存内容はベンダーごとに独立で、切り替えても元のベンダーの内容は失われない", async () => {
    saveConnectedLocation("adguardvpn", { locationId: "jp-tokyo", country: "jp" }, "TOKYO");
    await app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "mockproton" } });
    // 切替で切断したため、AdGuard側の保存は消える（切断したので正しい）。別のベンダー（mockproton）の観測は影響しない。
    expect(reconcileLocation("mockproton", { status: "disconnected" })).toEqual({ status: "disconnected" });
    saveConnectedLocation("mockproton", { locationId: "us-united-states", country: "us" }, "NEW YORK");
    expect(reconcileLocation("mockproton", { status: "connected", location: "NEW YORK" }).country).toBe("us");
  });
});
