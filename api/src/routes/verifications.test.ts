// 責務: 設定の動作検証のルート（`/v1/verifications`）の統合テスト。ゲートウェイとの通信（proxy-client）はモックする。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "adguardvpn";
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
process.env.STATE_DIR = dir;
process.env.SETTINGS_FILE = join(dir, "settings.json");

const mocks = vi.hoisted(() => ({
  runGatewayCheck: vi.fn(),
  registerCheckNonce: vi.fn(),
  fetchCheckNonce: vi.fn(),
}));

vi.mock("../proxy-client/proxy-client.js", () => mocks);

const { buildApp: buildRawApp } = await import("../app.js");
const { withAuthenticatedInject } = await import("../auth/test-support.js");
const { readAuditLog } = await import("../audit-log/audit-log-store.js");

describe("/v1/verifications", () => {
  beforeEach(() => {
    mocks.runGatewayCheck.mockImplementation(async (input: { check: string }) => ({
      id: input.check,
      status: "pass",
      observed: "ok",
      ...(input.check === "tunnel-egress" ? { value: "198.51.100.7" } : {}),
    }));
    mocks.registerCheckNonce.mockResolvedValue(undefined);
    mocks.fetchCheckNonce.mockResolvedValue({ received: true, redirected: true, recentRedirectedClients: 1 });
  });

  it("未認証は401", async () => {
    const response = await buildRawApp().inject({ method: "POST", url: "/v1/verifications" });
    expect(response.statusCode).toBe(401);
  });

  it("開始は202で検証を返し、GETで進行・結果を取得できる。ブラウザの出口IPを提出できる", async () => {
    const app = withAuthenticatedInject(buildRawApp());
    const started = await app.inject({ method: "POST", url: "/v1/verifications" });
    expect(started.statusCode).toBe(202);
    const body = started.json();
    expect(body.state).toBe("running");
    expect(body.checks[0]).toMatchObject({ id: "gateway-rules", group: "config", title: "透過ゲートウェイの構成" });

    // 既定の設定では明示的プロキシ・DNS中継が無効。
    expect(body.clientProbe).toBeUndefined();
    const submitted = await app.inject({
      method: "PUT",
      url: `/v1/verifications/${body.id}/client-observations/egress-ip`,
      payload: { ip: "198.51.100.7" },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toEqual({ accepted: true });

    await vi.waitFor(async () => {
      const current = await app.inject({ method: "GET", url: `/v1/verifications/${body.id}` });
      expect(current.json().state).toBe("completed");
    }, { timeout: 10_000, interval: 100 });
    const done = (await app.inject({ method: "GET", url: `/v1/verifications/${body.id}` })).json();
    expect(done.checks.find((check: { id: string }) => check.id === "client-egress").status).toBe("pass");
    expect(readAuditLog().at(-1)?.action).toBe("verification_run");
  });

  it("実行中の開始は409", async () => {
    const app = withAuthenticatedInject(buildRawApp());
    const first = await app.inject({ method: "POST", url: "/v1/verifications" });
    const second = await app.inject({ method: "POST", url: "/v1/verifications" });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("verification_running");
    await app.inject({ method: "PUT", url: `/v1/verifications/${first.json().id}/client-observations/egress-ip`, payload: { ip: null } });
    await vi.waitFor(async () => {
      const current = await app.inject({ method: "GET", url: `/v1/verifications/${first.json().id}` });
      expect(current.json().state).toBe("completed");
    }, { timeout: 10_000, interval: 100 });
  });

  it("未知のIDは404、IPv4でない出口IPは400", async () => {
    const app = withAuthenticatedInject(buildRawApp());
    const unknown = "00000000-0000-0000-0000-000000000000";
    expect((await app.inject({ method: "GET", url: `/v1/verifications/${unknown}` })).statusCode).toBe(404);
    const invalid = await app.inject({
      method: "PUT",
      url: `/v1/verifications/${unknown}/client-observations/egress-ip`,
      payload: { ip: "2001:db8::1" },
    });
    expect(invalid.statusCode).toBe(400);
  });
});
