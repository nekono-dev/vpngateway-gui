// 責務: APIサーバの受け入れテスト共通の起動ヘルパー。
// ゲートウェイの代役（相互TLS）・状態の保存先・ベンダーバンドルを環境変数で与えてから、`buildApp()` をインポートして返す。
// 環境変数はモジュールの読み込み時に参照されるため、必ずこのヘルパーを先頭で呼んでからAPIの他のモジュールをインポートする。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeGateway, type FakeGateway, type FakeGatewayHandlers } from "./fake-gateway.js";
import { createTestPki, type TestPki } from "./pki.js";
import { repoPath } from "./repo.js";

export interface ApiHarnessOptions {
  /** 有効にするベンダーID（カンマ区切り）。既定は全バンドル。 */
  providers?: string;
  handlers?: FakeGatewayHandlers;
  /** プラン別の参考一覧の読み取り元（PROVIDER_CACHE_DIR）。 */
  providerCacheDir?: string;
}

export interface ApiHarness {
  /** ログイン済みのCookieを付けて呼ぶ `inject`。認証を検証したいときは `rawApp` を使う。 */
  app: Awaited<ReturnType<typeof importBuildApp>>;
  rawApp: Awaited<ReturnType<typeof importBuildApp>>;
  gateway: FakeGateway;
  pki: TestPki;
  stateDir: string;
  auditLogFile: string;
  /** ログイン済みのCookieヘッダ値。 */
  cookie: string;
  stop: () => Promise<void>;
}

async function importBuildApp() {
  const { buildApp } = await import("../../api/src/app.js");
  return buildApp();
}

/**
 * 目的: ゲートウェイの代役とAPIサーバのアプリケーションを起動する。
 * 入力: options（有効にするベンダー・ゲートウェイの応答）。
 * 出力: アプリ・ゲートウェイ・状態の保存先・ログイン済みCookie・停止関数。
 */
export async function startApiHarness(options: ApiHarnessOptions = {}): Promise<ApiHarness> {
  const pki = createTestPki("gateway");
  const gateway = await startFakeGateway(pki, options.handlers);
  const stateDir = mkdtempSync(join(tmpdir(), "vpngwgui-accept-api-"));
  const auditLogFile = join(stateDir, "audit.log");
  Object.assign(process.env, {
    VENDORS_DIR: repoPath("vendors"),
    ENABLED_PROVIDERS: options.providers ?? "adguardvpn,protonvpn",
    STATE_DIR: stateDir,
    AUDIT_LOG_FILE: auditLogFile,
    SETTINGS_FILE: join(stateDir, "settings.json"),
    GATEWAY_HOST: "127.0.0.1",
    GATEWAY_PORT: String(gateway.port),
    GATEWAY_TLS_CA_FILE: pki.caCert,
    GATEWAY_TLS_CERT_FILE: pki.clientCert,
    GATEWAY_TLS_KEY_FILE: pki.clientKey,
    PROVIDER_CACHE_DIR: options.providerCacheDir ?? join(stateDir, "provider-cache"),
  });
  const rawApp = await importBuildApp();
  const { withAuthenticatedInject, setUpAuthenticatedOperator } = await import("../../api/src/auth/test-support.js");
  const cookie = setUpAuthenticatedOperator();
  const app = withAuthenticatedInject(await importBuildApp());
  return {
    app,
    rawApp,
    gateway,
    pki,
    stateDir,
    auditLogFile,
    cookie,
    stop: async () => {
      await app.close();
      await rawApp.close();
      await gateway.close();
    },
  };
}
