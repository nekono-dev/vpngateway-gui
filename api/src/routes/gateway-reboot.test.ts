// 責務: POST /v1/gateway/reboot（ゲートウェイ機の再起動の依頼）の統合テスト。proxy-clientはモックする。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "adguardvpn";
// 監査ログの保存先はモジュール読み込み時に固定されるため、動的importより前に設定する。
const auditDir = mkdtempSync(join(tmpdir(), "vpngwgui-audit-"));
const auditLog = join(auditDir, "audit.log");
process.env.AUDIT_LOG_FILE = auditLog;

const requestGatewayReboot = vi.fn<() => Promise<void>>();
vi.mock("../proxy-client/proxy-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../proxy-client/proxy-client.js")>()),
  requestGatewayReboot: () => requestGatewayReboot(),
}));

const { buildApp } = await import("../app.js");
const { clearFailures } = await import("../auth/login-rate-limiter.js");
const { setUpAuthenticatedOperator } = await import("../auth/test-support.js");
const { HostControlUnavailableError, RebootAlreadyRequestedError } = await import("../errors.js");

let cookie: string;
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
  process.env.STATE_DIR = dir;
  clearFailures("127.0.0.1");
  requestGatewayReboot.mockReset();
  cookie = setUpAuthenticatedOperator("admin", "correct-password");
});

function post(app: ReturnType<typeof buildApp>, password: string, withCookie = true) {
  return app.inject({
    method: "POST",
    url: "/v1/gateway/reboot",
    payload: { password },
    headers: withCookie ? { cookie } : {},
  });
}

describe("POST /v1/gateway/reboot", () => {
  it("正しいパスワードで依頼を受け付け、202を返し、監査ログへ記録する（パスワードは記録しない）", async () => {
    requestGatewayReboot.mockResolvedValue();
    const response = await post(buildApp(), "correct-password");
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ requested: true });
    const log = readFileSync(auditLog, "utf8");
    expect(log).toContain('"action":"gateway_reboot"');
    expect(log).not.toContain("correct-password");
  });

  it("誤ったパスワードは401で、依頼しない", async () => {
    const response = await post(buildApp(), "wrong");
    expect(response.statusCode).toBe(401);
    expect(requestGatewayReboot).not.toHaveBeenCalled();
  });

  it("未ログインは401", async () => {
    const response = await post(buildApp(), "correct-password", false);
    expect(response.statusCode).toBe(401);
    expect(requestGatewayReboot).not.toHaveBeenCalled();
  });

  it("失敗が続くと429になる", async () => {
    const app = buildApp();
    for (let i = 0; i < 5; i += 1) await post(app, "wrong");
    expect((await post(app, "correct-password")).statusCode).toBe(429);
  });

  it("ホスト側の仕組みが未導入なら503、すでに依頼済みなら409", async () => {
    const app = buildApp();
    requestGatewayReboot.mockRejectedValueOnce(new HostControlUnavailableError("x"));
    expect((await post(app, "correct-password")).statusCode).toBe(503);
    requestGatewayReboot.mockRejectedValueOnce(new RebootAlreadyRequestedError("x"));
    expect((await post(app, "correct-password")).statusCode).toBe(409);
  });
});
