// 責務: 画面確認で使う API のモック。`/api/*` への要求を Playwright のルートで置き換え、
// 認証の状態・テーマの保存値・保存の成否を試験ごとに切り替える。

import type { Page, Route } from "@playwright/test";

export type ThemeValue = "system" | "light" | "dark";

export interface MockOptions {
  /** 初期設定が済んでいるか（false なら初期設定画面）。 */
  configured?: boolean;
  /** ログイン済みかどうか（false ならログイン画面）。 */
  loggedIn?: boolean;
  /** 保存済みのテーマ（GET /v1/ui-preferences の応答）。 */
  theme?: ThemeValue;
  /** GET /v1/ui-preferences の応答を遅らせる時間（ms）。取得中の空白の確認に使う。 */
  themeDelayMs?: number;
  /** GET /v1/ui-preferences を失敗させる（応答のステータス）。 */
  themeGetStatus?: number;
  /** PUT /v1/ui-preferences を失敗させる（応答のステータス）。 */
  themePutStatus?: number;
}

export interface MockState {
  /** 受け取った PUT の本文（送信順）。 */
  savedThemes: ThemeValue[];
}

/**
 * 目的: 画面確認用の API モックを設定する。
 * 入力: page（対象のページ）、options（試験ごとの状態）。
 * 出力: 受け取った保存の記録（MockState）。
 * 副作用: page の `/api/*` への要求をすべて置き換える（未定義の経路は 503 で返す）。
 */
export async function mockApi(page: Page, options: MockOptions = {}): Promise<MockState> {
  const state: MockState = { savedThemes: [] };
  let currentTheme: ThemeValue = options.theme ?? "system";

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/api/v1/operator" && request.method() === "GET") {
      if (options.configured === false) {
        return json(200, { configured: false });
      }
      // GET /v1/operator は有効なセッションがあるときだけ username を含める（AuthContext の判定と同じ）。
      return json(200, options.loggedIn ? { configured: true, username: "admin" } : { configured: true });
    }
    if (path === "/api/v1/operator/session" && request.method() === "GET") {
      return options.loggedIn ? json(200, { authenticated: true }) : json(401, { error: "unauthenticated" });
    }
    if (path === "/api/v1/operator/session" && request.method() === "POST") {
      return json(200, { authenticated: true });
    }
    if (path === "/api/v1/ui-preferences" && request.method() === "GET") {
      if (options.themeDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.themeDelayMs));
      }
      if (options.themeGetStatus) {
        return json(options.themeGetStatus, { error: "internal_error" });
      }
      return json(200, { theme: currentTheme });
    }
    if (path === "/api/v1/ui-preferences" && request.method() === "PUT") {
      const body = JSON.parse(request.postData() ?? "{}") as { theme: ThemeValue };
      state.savedThemes.push(body.theme);
      if (options.themePutStatus) {
        return json(options.themePutStatus, { error: "internal_error" });
      }
      currentTheme = body.theme;
      return json(200, { theme: body.theme });
    }
    // ダッシュボードの他の取得は、この試験の対象外として利用できない応答にする（画面は残り、要素の表示は各試験の範囲で確かめる）。
    return json(503, { error: "mock_unavailable" });
  });

  return state;
}
