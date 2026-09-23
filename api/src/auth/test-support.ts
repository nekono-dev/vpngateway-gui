// 責務: テスト専用。Web UI利用者アカウントの作成・ログイン済みセッションCookieの発行を1ステップで行う。
// Phase 25で全`/v1/*`ルートに認可（require-operator-session.ts）を追加したため、既存の
// `app.inject`を使うルート統合テストは、このヘルパーで取得したCookieを`headers.cookie`へ渡す必要がある。

import { createOperatorAccount, isOperatorConfigured } from "./operator-account-store.js";
import { createSession, SESSION_COOKIE_NAME } from "./session-store.js";

/**
 * 目的: テスト用のオペレーターアカウントを作成し、ログイン済みのCookieヘッダ値を返す。
 * 入力: username, password（省略可。既定値はテスト用の固定値）。
 * 出力: `app.inject({ headers: { cookie } })`へそのまま渡せるCookieヘッダ値。
 * 副作用: operator-account-store・session-storeへ書き込む（呼び出し前にSTATE_DIRをテスト用に切り替えておくこと）。
 *        同一STATE_DIRに対して複数回呼んでも安全（アカウントは初回のみ作成し、セッションは毎回新規発行する）。
 */
export function setUpAuthenticatedOperator(username = "test-admin", password = "test-password-1234"): string {
  if (!isOperatorConfigured()) {
    createOperatorAccount(username, password);
  }
  const sessionId = createSession();
  return `${SESSION_COOKIE_NAME}=${sessionId}`;
}

/**
 * 目的: Phase 25で追加した全`/v1/*`ルートの認可により401になってしまう既存ルート統合テストのために、
 *      `buildApp()`が返すFastifyインスタンスの`inject`を、常にログイン済みCookieを付与するようラップする。
 * 入力: app(buildApp()の戻り値そのもの)。
 * 出力: 同じappインスタンス（`inject`のみ差し替え済み）。
 * 例: function buildApp() { return withAuthenticatedInject(buildRawApp()); }
 */
export function withAuthenticatedInject<T extends { inject: (...args: never[]) => unknown }>(app: T): T {
  const cookie = setUpAuthenticatedOperator();
  const originalInject = app.inject.bind(app);
  app.inject = ((opts: unknown) => {
    const merged: Record<string, unknown> = typeof opts === "string" ? { url: opts } : { ...(opts as Record<string, unknown>) };
    const headers = { ...((merged.headers as Record<string, unknown>) ?? {}), cookie };
    return originalInject({ ...merged, headers } as never);
  }) as T["inject"];
  return app;
}
