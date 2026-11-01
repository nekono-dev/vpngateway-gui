// 責務: 初期設定・ログイン・ログアウトの画面試験（stack 群・ui）。要件 2.1・2.2・2.3・2.4・2.8。
// 直列に実行する（初期設定の画面は、管理者が無い間だけ出るため、この群が最初に実行される）。

import { test, expect } from "../../fixtures/web";
import { makeAdminCredentials } from "../../fixtures/admin";
import { apiClient, saveAdmin } from "../../fixtures/stack";

test.describe.serial("初期設定・ログイン・ログアウト（ui）", () => {
  const admin = makeAdminCredentials();

  test("2.1: 管理者アカウントが無いとき、初期設定の画面を出す", async ({ watchedPage: page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "初期設定" })).toBeVisible();
  });

  test("2.3: パスワードが一致しないと「パスワードが一致しません」を出し、アカウントを作らない", async ({ watchedPage: page }) => {
    await page.goto("/");
    await page.getByLabel("ユーザー名").fill(admin.username);
    await page.getByLabel("パスワード（4文字以上）").fill(admin.password);
    await page.getByLabel("パスワード（確認）").fill(`${admin.password}-x`);
    await page.getByRole("button", { name: "設定する" }).click();
    await expect(page.getByRole("alert")).toHaveText("パスワードが一致しません");

    // アカウントが作られていないことを、API の状態で確かめる
    const state = await apiClient().get<{ configured: boolean }>("/v1/operator");
    expect(state.ok && state.body.configured).toBe(false);
  });

  test("2.2: 同じパスワードで作成すると、ダッシュボードを表示する", async ({ watchedPage: page }) => {
    await page.goto("/");
    await page.getByLabel("ユーザー名").fill(admin.username);
    await page.getByLabel("パスワード（4文字以上）").fill(admin.password);
    await page.getByLabel("パスワード（確認）").fill(admin.password);
    await page.getByRole("button", { name: "設定する" }).click();
    await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
    await saveAdmin(admin);
  });

  test("2.8: ログアウトすると、ログイン画面へ戻る", async ({ watchedPage: page }) => {
    // 試験ごとに新しいブラウザの状態になるため、この試験で改めてログインしてからログアウトする
    await page.goto("/");
    await page.getByLabel("ユーザー名").fill(admin.username);
    await page.getByLabel("パスワード", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: /^ログイン/ }).click();
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  });

  test("2.4: 誤ったパスワードで「パスワードが正しくありません」を出す。正しい資格情報でダッシュボードへ進む", async ({ watchedPage: page, pageErrors }) => {
    // 誤った資格情報の 401 は、この試験の意図した結果（ブラウザがリソースの失敗として記録する）
    pageErrors.allow(/status of 401 \(Unauthorized\) \(https:\/\/127\.0\.0\.1:18080\/api\/v1\/operator\/session\)/);
    await page.goto("/");
    await page.getByLabel("ユーザー名").fill(admin.username);
    await page.getByLabel("パスワード", { exact: true }).fill(`${admin.password}-wrong`);
    await page.getByRole("button", { name: /^ログイン/ }).click();
    await expect(page.getByRole("alert")).toContainText("パスワードが正しくありません");

    await page.getByLabel("パスワード", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: /^ログイン/ }).click();
    await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  });
});
