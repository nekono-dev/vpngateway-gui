// 責務: GET /v1/connection/gateway の統合テスト。プロキシとの実通信はproxy-clientをモックし、
// Fastifyアプリ全体（ルーティング・エラーハンドラ）を通した挙動（中継・502・504）を検証する。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "adguardvpn";
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
process.env.STATE_DIR = dir;

const { fetchProxyStatusMock } = vi.hoisted(() => ({ fetchProxyStatusMock: vi.fn() }));

vi.mock("../proxy-client/proxy-client.js", () => ({
  fetchProxyStatus: fetchProxyStatusMock,
}));

const { buildApp: buildRawApp } = await import("../app.js");
const { withAuthenticatedInject } = await import("../auth/test-support.js");
// Phase 25で追加した/v1/*の認可により、認証無しのapp.injectは401になるため、
// 既存の統合テストはログイン済みCookie付きのinjectへ差し替えて呼び出す。
function buildApp() {
  return withAuthenticatedInject(buildRawApp());
}
const { ProxyUnavailableError, ProxyTimeoutError, GatewayProtectionMismatchError } = await import("../errors.js");

describe("GET /v1/connection/gateway", () => {
  beforeEach(() => {
    fetchProxyStatusMock.mockReset();
  });

  it("プロキシの稼働状況をそのまま200で返す", async () => {
    const status = {
      transparentGateway: { state: "active", vpnInterface: "tun0", killSwitchBlocking: false },
      explicitProxy: { state: "crashLoop", restartCount: 4 },
      gatewayGuard: { state: "LEASE", healthy: true, leaseValid: true, lastUpdatedAt: "2026-11-18T00:00:00.000Z" },
    };
    fetchProxyStatusMock.mockResolvedValue(status);

    const response = await buildApp().inject({ method: "GET", url: "/v1/connection/gateway" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(status);
  });

  it("DNS中継の稼働状況（Phase 14）も、そのまま200で返す", async () => {
    const status = {
      transparentGateway: { state: "active", killSwitchBlocking: false },
      explicitProxy: { state: "stopped", restartCount: 0 },
      dnsRelay: { state: "active", upstream: "failing", bypassEntries: 12 },
      gatewayGuard: { state: "UNKNOWN", healthy: false, leaseValid: false, lastUpdatedAt: null },
    };
    fetchProxyStatusMock.mockResolvedValue(status);

    const response = await buildApp().inject({ method: "GET", url: "/v1/connection/gateway" });

    expect(response.statusCode).toBe(200);
    expect(response.json().dnsRelay).toEqual(status.dnsRelay);
  });

  it("プロキシ未応答は502", async () => {
    fetchProxyStatusMock.mockRejectedValue(new ProxyUnavailableError("down"));
    const response = await buildApp().inject({ method: "GET", url: "/v1/connection/gateway" });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe("proxy_unavailable");
  });

  it("プロキシ応答タイムアウトは504", async () => {
    fetchProxyStatusMock.mockRejectedValue(new ProxyTimeoutError("slow"));
    const response = await buildApp().inject({ method: "GET", url: "/v1/connection/gateway" });
    expect(response.statusCode).toBe(504);
    expect(response.json().error).toBe("proxy_timeout");
  });

  it("通信保護方式の不一致は専用コードと状態を返す", async () => {
    fetchProxyStatusMock.mockRejectedValue(new GatewayProtectionMismatchError("API と Gateway の通信保護設定が一致しません"));
    const response = await buildApp().inject({ method: "GET", url: "/v1/connection/gateway" });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: "gateway_protection_mismatch", protectionModeMismatch: true });
  });
});
