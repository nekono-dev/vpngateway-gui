// 責務: GET /v1/connection/gateway の統合テスト。プロキシとの実通信はproxy-clientをモックし、
// Fastifyアプリ全体（ルーティング・エラーハンドラ）を通した挙動（中継・502・504）を検証する。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "adguardvpn";
process.env.AUDIT_LOG_FILE = join(mkdtempSync(join(tmpdir(), "vpngwgui-test-")), "audit.log");

const { fetchProxyStatusMock } = vi.hoisted(() => ({ fetchProxyStatusMock: vi.fn() }));

vi.mock("../proxy-client/proxy-client.js", () => ({
  fetchProxyStatus: fetchProxyStatusMock,
}));

const { buildApp } = await import("../app.js");
const { ProxyUnavailableError, ProxyTimeoutError } = await import("../errors.js");

describe("GET /v1/connection/gateway", () => {
  beforeEach(() => {
    fetchProxyStatusMock.mockReset();
  });

  it("プロキシの稼働状況をそのまま200で返す", async () => {
    const status = {
      transparentGateway: { state: "active", vpnInterface: "tun0", killSwitchBlocking: false },
      explicitProxy: { state: "crashLoop", restartCount: 4 },
    };
    fetchProxyStatusMock.mockResolvedValue(status);

    const response = await buildApp().inject({ method: "GET", url: "/v1/connection/gateway" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(status);
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
});
