// 責務: 画面の表示と操作の試験（stack 群・ui）。要件 3.6・4.2・4.3・12.1・12.2・12.4。
// 接続先のお気に入り、接続ログ、設定ダイアログの全タブと動作検証、VPN のログアウト、API のエラー（502）の通知を、
// 画面に表示された結果で確かめる。直列に実行する（VPN のログイン状態と、ランナーの停止を、前の試験から引き継ぐ）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "../../fixtures/web";
import type { Page } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { apiClient, runnerContainer } from "../../fixtures/stack";
import { connectVpn, disconnectVpn, ensureAdminLogin, loginVpn, MOCK_PASSWORD, MOCK_USER } from "../../fixtures/gateway";
import { loginDashboard, openSettings } from "../../fixtures/ui";

const run = promisify(execFile);

/** 目的: 設定ダイアログの全タブ（表示中のもの）を、順に開いて確かめる。 */
async function expectEveryTab(dialog: Locator): Promise<void> {
  for (const name of ["通信制御", "ゲートウェイ", "上位DNSリゾルバ", "動作検証", "メンテナンス"]) {
    const tab = dialog.getByRole("tab", { name, exact: true });
    await tab.click();
    await expect(tab, `${name} タブが選ばれる`).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("tabpanel"), `${name} の内容が出る`).toBeVisible();
  }
}

test.describe.serial("画面の表示と操作（ui）", () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });
  const client = apiClient();

  test.beforeAll(async () => {
    test.setTimeout(3 * 60 * 1000);
    await ensureAdminLogin(client);
    await loginVpn(client);
  });

  test.afterAll(async () => {
    // 後始末: ランナーを起動状態に戻す
    await run("sudo", ["docker", "start", runnerContainer("protonvpn")]).catch(() => undefined);
  });

  // 未処理の JavaScript の例外は、そのシナリオを失敗にする（watchedPage の監視）。失敗すること自体が期待の結果
  test.fail("12.3: 未処理の JavaScript の例外があると、そのシナリオは失敗になる", async ({ watchedPage: page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("意図的な例外（12.3 の確認）");
      }, 0);
    });
    await page.waitForTimeout(500);
  });

  test("4.2・4.3・12.2: お気に入りを登録・解除すると、一覧の表示が変わる", async ({ watchedPage: page }) => {
    await loginDashboard(page);
    const add = page.getByRole("button", { name: /をお気に入りに追加$/ }).first();
    await expect(add, "お気に入りに追加のボタンが無い").toBeVisible();
    const label = (await add.getAttribute("aria-label")) ?? "";
    const target = label.replace(/をお気に入りに追加$/, "");

    await add.click();
    const remove = page.getByRole("button", { name: `${target}のお気に入りを解除` });
    await expect(remove, "登録後に解除の表示になる").toBeVisible();

    // 再読み込みの後も、登録が保たれている（API の状態を画面が表示する）
    await page.reload();
    await expect(page.getByRole("button", { name: `${target}のお気に入りを解除` })).toBeVisible();

    await page.getByRole("button", { name: `${target}のお気に入りを解除` }).click();
    await expect(page.getByRole("button", { name: `${target}をお気に入りに追加` })).toBeVisible();
  });

  test("12.1: 接続ログの画面が開き、一覧の見出しを表示する（3.4）", async ({ watchedPage: page }) => {
    await loginDashboard(page);
    await page.getByRole("button", { name: "接続ログ", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "接続ログ" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "接続ログ" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("12.1: 設定ダイアログの全タブを開き、動作検証を実行して結果を表示する", async ({ watchedPage: page }) => {
    await loginDashboard(page);
    const dialog = await openSettings(page);
    await expectEveryTab(dialog);

    // 動作検証タブで検証を実行し、完了の表示（もう一度実行）になる
    await dialog.getByRole("tab", { name: "動作検証", exact: true }).click();
    await dialog.getByRole("button", { name: "検証を実行" }).click();
    await expect(dialog.getByRole("button", { name: "もう一度実行" })).toBeVisible({ timeout: 3 * 60 * 1000 });
    await dialog.getByRole("button", { name: "キャンセル" }).click();
  });

  test("3.1・3.2・3.4: 接続すると接続中、切断すると切断と画面に出る。接続ログに両方の操作が並ぶ", async ({ watchedPage: page }) => {
    // 接続と切断は API で行い、その結果を画面（接続状態の表示と接続ログの一覧）で確かめる
    await loginDashboard(page);
    await connectVpn(client);
    await expect(page.locator(".connection-label"), "接続中の表示が出ない").toHaveText("接続中", { timeout: 60 * 1000 });

    await disconnectVpn(client);
    await expect(page.locator(".connection-label"), "切断の表示が出ない").toHaveText("切断", { timeout: 60 * 1000 });

    await page.getByRole("button", { name: "接続ログ", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "接続ログ" });
    await expect(dialog.getByRole("cell", { name: "接続", exact: true }), "接続の操作が一覧に無い").not.toHaveCount(0);
    await expect(dialog.getByRole("cell", { name: "切断", exact: true }), "切断の操作が一覧に無い").not.toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("3.6・12.1: VPN からログアウトすると、ログインの導線に戻る", async ({ watchedPage: page }) => {
    // ログアウトの確認（window.confirm）は承認する
    page.once("dialog", (dialog) => void dialog.accept());
    await loginDashboard(page);
    const session = page.locator(".session-action");
    await session.getByRole("button", { name: "ログアウト", exact: true }).click();
    await expect(session.getByRole("button", { name: "ログイン", exact: true })).toBeVisible();

    const state = await client.get<{ loggedIn?: boolean }>("/v1/session");
    expect(state.ok && state.body.loggedIn).toBe(false);
  });

  test("12.4: API が 502 を返すと、利用者に分かるエラーの通知を表示する", async ({ watchedPage: page, pageErrors }) => {
    // 502 の応答は、ブラウザがリソースの失敗として記録する（この試験の意図した結果）
    pageErrors.allow(/status of 502/);
    // 前提: VPN は未ログイン（3.6 の後）。ランナーを止めると、ログインの要求は 502 になる
    await run("sudo", ["docker", "stop", runnerContainer("protonvpn")]);
    try {
      await loginDashboard(page);
      await page.getByRole("button", { name: "ログイン", exact: true }).click();
      await page.getByLabel("ユーザー名").fill(MOCK_USER);
      await page.getByLabel("パスワード", { exact: true }).fill(MOCK_PASSWORD);
      await page.getByRole("button", { name: "ログイン", exact: true }).click();
      const toast = page.locator(".toast-region [role=alert]").first();
      await expect(toast, "502 の通知が出ない").toBeVisible();
    } finally {
      await run("sudo", ["docker", "start", runnerContainer("protonvpn")]);
    }
  });
});
