// 責務: 認証の画面（初期設定・ログイン・ログアウト）の実ブラウザのテスト。
// Webの開発サーバを起動し、APIサーバの応答はブラウザ側で再現する。

import { expect, test } from "playwright/test";
import { installMockApi } from "./helpers/mock-api.js";
import { startViteServer, type ViteServer } from "./helpers/vite-server.js";

let server: ViteServer;

test.beforeAll(async () => {
  server = await startViteServer();
});
test.afterAll(() => {
  server.stop();
});

test("未認証でページを開くと初期設定画面になり、作成後はダッシュボード、ログアウト後はログイン画面になる", async ({ page }) => {
  const api = await installMockApi(page, { configured: false, authenticated: false });
  await page.goto(server.url);
  // アカウント未作成: 初期設定画面だけが表示され、ダッシュボードは表示されない。
  await expect(page.getByRole("heading", { name: "初期設定" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "VPNGateway-GUI" })).toHaveCount(0);

  await page.getByLabel("ユーザー名").fill("admin");
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill("correct-horse-battery");
  await passwords.nth(1).fill("correct-horse-battery");
  await page.getByRole("button", { name: /作成|設定|登録/ }).click();
  await expect(page.getByRole("heading", { name: "VPNGateway-GUI" })).toBeVisible();
  expect(api.calls.some((call) => call.method === "POST" && call.path === "/v1/operator")).toBe(true);

  // ログアウトするとログイン画面になり、ダッシュボードの操作は見えなくなる。
  await page.getByRole("button", { name: "ログアウト" }).first().click();
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "VPNGateway-GUI" })).toHaveCount(0);

  // 再びログインすると、ダッシュボードへ戻る。
  await page.getByLabel("ユーザー名").fill("admin");
  await page.locator('input[type="password"]').fill("correct-horse-battery");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: "VPNGateway-GUI" })).toBeVisible();
});
