// 責務: 画面試験（ui 群）の共通部品。管理者でログインする操作と、設定ダイアログを開く操作を、試験ごとに同じにする。

import { expect } from "./web";
import type { Page } from "@playwright/test";
import { loadAdmin } from "./stack";

/**
 * 目的: 管理者でダッシュボードへ入る。ログイン済みなら何もしない（再読み込みの後でも使えるように）。
 * 理由: 試験ごとにブラウザの状態は変わるが、同じ試験の中の再読み込みでは Cookie が残るため。
 */
export async function loginDashboard(page: Page): Promise<void> {
  const admin = await loadAdmin();
  await page.goto("/");
  if (await page.getByRole("button", { name: "ログアウト" }).isVisible().catch(() => false)) return;
  await page.getByLabel("ユーザー名").fill(admin.username);
  await page.getByLabel("パスワード", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: /^ログイン/ }).click();
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
}

/** 目的: ダッシュボードの［設定］を開き、ダイアログが表示されるまで待つ。 */
export async function openSettings(page: Page) {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "設定" });
  await expect(dialog).toBeVisible();
  return dialog;
}
