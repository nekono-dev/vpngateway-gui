// 責務: 設定ダイアログ（タブの切替・行リストエディタ・一括の保存）と動作検証の実ブラウザのテスト。
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

test("設定ダイアログでタブを切り替えて迂回ドメインを追加して保存すると設定が一括で送信され、動作検証の実行で各項目の結果が表示される", async ({ page }) => {
  const api = await installMockApi(page);
  await page.goto(server.url);
  await page.getByRole("button", { name: "設定" }).click();
  const dialog = page.getByRole("dialog", { name: /設定/ });
  await expect(dialog.getByRole("tab", { name: "通信制御" })).toHaveAttribute("aria-selected", "true");

  // 迂回ドメインの行を追加し、別のタブへ切り替えて戻っても、入力が残っている。
  const editor = dialog.getByRole("listbox", { name: /迂回ドメイン/ }).locator("xpath=ancestor::*[contains(@class,'line-list-frame')][1]");
  await editor.getByRole("button", { name: /追加/ }).click();
  await page.keyboard.type("example.com");
  await page.keyboard.press("Enter");
  await dialog.getByRole("tab", { name: "ゲートウェイ" }).click();
  await expect(dialog.getByRole("checkbox", { name: /明示的プロキシモード/ })).toBeVisible();
  await dialog.getByRole("tab", { name: "通信制御" }).click();
  await expect(dialog.getByRole("listbox", { name: /迂回ドメイン/ }).locator("input").first()).toHaveValue("example.com");

  // 保存すると、全タブの内容がまとめて送信される。
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => api.calls.filter((call) => call.method === "PUT" && call.path === "/v1/connection/config").length).toBe(1);
  const saved = api.calls.find((call) => call.method === "PUT" && call.path === "/v1/connection/config")?.body as Record<string, unknown>;
  expect(saved.excludedDomains).toEqual(["example.com"]);
  expect(saved.killSwitch).toBe(true);

  // 動作検証を実行すると、進行の後に各項目の結果が表示される。
  await page.getByRole("button", { name: "設定" }).click();
  await dialog.getByRole("tab", { name: "動作検証" }).click();
  await dialog.getByRole("button", { name: "検証を実行" }).click();
  await expect(dialog.getByRole("button", { name: "もう一度実行" })).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("OK 3件")).toBeVisible();
  // ブラウザが出口IPの提出をAPIへ行っている（利用者の操作は不要）。
  expect(api.calls.some((call) => call.method === "PUT" && call.path.endsWith("/client-observations/egress-ip"))).toBe(true);
});
