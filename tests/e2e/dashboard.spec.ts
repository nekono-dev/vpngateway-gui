// 責務: ダッシュボード（接続操作・ベンダーの切替・スマートフォン幅の表示）の実ブラウザのテスト。
// Webの開発サーバを起動し、APIサーバの応答はブラウザ側で再現する。
// 受け入れ条件 webserver/AC-24 は、スマートフォン幅の実ブラウザで確認する。

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

test("接続先を選んで接続を押すと接続中の表示になり、ベンダーを切り替えると確認を経て接続先の一覧が入れ替わる", async ({ page }) => {
  const api = await installMockApi(page);
  await page.goto(server.url);
  await expect(page.getByRole("heading", { name: "VPNGateway-GUI" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "VPNベンダー" })).toHaveValue("adguardvpn");

  // 接続先を選んで接続する。
  await page.locator("label.location-row", { hasText: "Tokyo" }).click();
  await page.getByRole("button", { name: "接続", exact: true }).click();
  await expect(page.locator("strong.connection-label")).toContainText("接続中");
  expect(api.calls.some((call) => call.method === "PUT" && call.path === "/v1/connection")).toBe(true);
  await expect(page.getByRole("button", { name: "切断" })).toBeVisible();

  // 接続中のベンダーの切替は、確認ダイアログを経る。承諾すると、新しいベンダーの接続先の一覧に入れ替わる。
  let confirmMessage = "";
  page.once("dialog", (dialog) => {
    confirmMessage = dialog.message();
    void dialog.accept();
  });
  await page.getByRole("combobox", { name: "VPNベンダー" }).selectOption("protonvpn");
  await expect(page.locator("label.location-row", { hasText: "Germany" })).toBeVisible();
  await expect(page.locator("label.location-row", { hasText: "Tokyo" })).toHaveCount(0);
  expect(confirmMessage).toContain("切断");
  expect(api.state.activeProvider).toBe("protonvpn");
});

test("webserver/AC-24: スマートフォン幅の実ブラウザで、ヘッダのタイトルが非表示になり、ページが横にスクロールしない", async ({ page }) => {
  await installMockApi(page);
  // スマートフォン幅（600ピクセル以下）: タイトルを隠し、操作ボタンだけを表示する。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(server.url);
  await expect(page.getByRole("button", { name: "設定" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "VPNGateway-GUI" })).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // ページ全体は縦にもスクロールせず、ビューポートに収まる。
  const verticalOverflow = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
  expect(verticalOverflow).toBeLessThanOrEqual(1);

  // 601ピクセル以上では、タイトルを表示する。
  await page.setViewportSize({ width: 700, height: 844 });
  await expect(page.getByRole("heading", { name: "VPNGateway-GUI" })).toBeVisible();
});
