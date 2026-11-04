// 責務: テーマの取得中（空白）・取得失敗（OS 規定で続行）・保存失敗（切り替え前へ差し戻し・通知）の画面確認。
// 対象: タスク 7.3（要件 2.3・3.4・4.1・4.2）。

import { expect, test } from "@playwright/test";
import { mockApi } from "./mock-api";

test("テーマの取得中は画面が空白で、取得が終わると保存済みのテーマで描画される（4.1・4.2）", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mockApi(page, { configured: true, loggedIn: false, theme: "dark", themeDelayMs: 2000 });
  await page.goto("/");
  // 取得が終わるまで、認証の画面も含めて何も描画しない。
  await expect(page.locator("#root")).toBeEmpty();
  // 取得が終わると、ログイン画面が保存済みのダークで描画される（ライトからの切り替わりを見せない）。
  await expect(page.locator("form").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("テーマの取得に失敗しても、OS 規定として描画を続ける（3.4）", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockApi(page, { configured: true, loggedIn: false, themeGetStatus: 500 });
  await page.goto("/");
  await expect(page.locator("form").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("テーマの取得が失敗し、OS の配色がライトなら、ライトで描画する（3.4）", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mockApi(page, { configured: true, loggedIn: false, themeGetStatus: 500 });
  await page.goto("/");
  await expect(page.locator("form").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("保存に失敗すると、切り替え前のテーマへ戻り、通知を出す（2.3）", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mockApi(page, { loggedIn: true, theme: "system", themePutStatus: 500 });
  await page.goto("/");
  await page.getByRole("button", { name: "テーマ: OS 規定" }).click();

  // 切り替え前（OS 規定）へ戻り、表示も OS の配色（ライト）のままになる。
  await expect(page.getByRole("button", { name: "テーマ: OS 規定" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  // 利用者に保存できなかったことを伝える。
  await expect(page.getByText("テーマの保存に失敗しました")).toBeVisible();
});
