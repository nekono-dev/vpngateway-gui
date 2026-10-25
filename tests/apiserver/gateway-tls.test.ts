// 責務: ゲートウェイとの通信の証明書検証の受け入れテスト。
// 受け入れ条件 apiserver/AC-28 を、別の認証局の証明書を持つゲートウェイとの通信が失敗することで確認する。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeGateway, type FakeGateway } from "../helpers/fake-gateway.js";
import { createTestPki } from "../helpers/pki.js";
import { repoPath } from "../helpers/repo.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let gateway: FakeGateway;
let app: Awaited<ReturnType<typeof buildApi>>;

async function buildApi() {
  const { buildApp } = await import("../../api/src/app.js");
  const { withAuthenticatedInject } = await import("../../api/src/auth/test-support.js");
  return withAuthenticatedInject(buildApp());
}

beforeAll(async () => {
  // ゲートウェイは「ゲートウェイの認証局」で署名した証明書を持つ。APIサーバは別の認証局だけを信頼する。
  const gatewayPki = createTestPki("gateway");
  const otherPki = createTestPki("other");
  gateway = await startFakeGateway(gatewayPki, { exec: () => ({ exitCode: 0, stdout: "VPN is disconnected\n", stderr: "" }) });
  const stateDir = mkdtempSync(join(tmpdir(), "vpngwgui-accept-tls-"));
  Object.assign(process.env, {
    VENDORS_DIR: repoPath("vendors"),
    ENABLED_PROVIDERS: "adguardvpn",
    STATE_DIR: stateDir,
    AUDIT_LOG_FILE: join(stateDir, "audit.log"),
    SETTINGS_FILE: join(stateDir, "settings.json"),
    GATEWAY_HOST: "127.0.0.1",
    GATEWAY_PORT: String(gateway.port),
    GATEWAY_TLS_CA_FILE: otherPki.caCert,
    GATEWAY_TLS_CERT_FILE: otherPki.clientCert,
    GATEWAY_TLS_KEY_FILE: otherPki.clientKey,
  });
  app = await buildApi();
});
afterAll(async () => {
  await app.close();
  await gateway.close();
});

describe("ゲートウェイとの通信の証明書検証", () => {
  it("apiserver/AC-28: 別の認証局の証明書を持つゲートウェイとは通信せず、502で失敗する", async () => {
    const status = await app.inject({ method: "GET", url: "/v1/connection/gateway" });
    expect(status.statusCode).toBe(502);
    const operation = await app.inject({ method: "GET", url: "/v1/connection" });
    expect(operation.statusCode).toBe(502);
    // ゲートウェイは、1件の要求も処理していない（検証を省略して接続し直す経路が無い）。
    expect(gateway.requests).toEqual([]);
  });
});
