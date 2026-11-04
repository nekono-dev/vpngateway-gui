// 責務: 画面確認の土台が動くことの確認（ダッシュボードのヘッダーが描画され、テーマが適用される）。

import { expect, test } from "@playwright/test";
import { mockApi } from "./mock-api";

test("ログイン済みのダッシュボードのヘッダーが描画され、テーマの属性が付く", async ({ page }) => {
  await mockApi(page, { loggedIn: true, theme: "light" });
  await page.goto("/");
  await expect(page.locator("header.app-header h1")).toHaveText("VPNGateway-GUI");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
