// 責務: 画面幅の試験（stack 群・ui）。要件 11.1〜11.5。
// 1280px・600px・420px で主要な画面を開き、表示と操作・横スクロールの有無・通知の位置を確かめる。
// 直列に実行する（試験ごとにブラウザの状態が変わるため、各試験で画面幅を設定し、ログインし直す）。

import { test, expect } from "../../fixtures/web";
import type { Page } from "@playwright/test";
import { apiClient, loadAdmin } from "../../fixtures/stack";
import { loginDashboard, openSettings } from "../../fixtures/ui";

const WIDE = 1280;
const TABLET = 600;
const PHONE = 420;

/** 目的: 画面幅を設定し、描画が落ち着くまで待つ。 */
async function setWidth(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
}

/** 目的: 横スクロールが出ていないことを確かめる（ページ全体の幅が画面の幅を超えない）。 */
async function expectNoHorizontalScroll(page: Page, width: number): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${width}px で横スクロールが出ている（超過 ${overflow}px）`).toBeLessThanOrEqual(0);
}

test.describe.serial("画面幅（ui）", () => {
  const client = apiClient();

  test.beforeAll(async () => {
    // ベンダーを有効にしておく（ダッシュボードのログイン導線を出すため）
    const admin = await loadAdmin();
    const login = await client.post("/v1/operator/session", admin);
    expect(login.ok, "管理者のログインに失敗").toBe(true);
    const put = await client.put("/v1/providers/active", { providerId: "protonvpn" });
    expect(put.ok, "プロバイダの切り替えに失敗").toBe(true);
  });

  test("11.1: 1280px・600px・420px で、ダッシュボードと設定ダイアログを開ける", async ({ watchedPage: page }) => {
    for (const width of [WIDE, TABLET, PHONE]) {
      await setWidth(page, width);
      await loginDashboard(page);
      await expect(page.getByRole("radiogroup", { name: "接続先" }), `${width}px の接続先`).toBeVisible();
      const dialog = await openSettings(page);
      await expect(dialog.getByRole("tab", { name: "通信制御" })).toBeVisible();
      await dialog.getByRole("button", { name: "キャンセル" }).click();
      await expect(dialog).toBeHidden();
      // 次の幅では、ログイン状態を保ったまま開き直す（同じブラウザの状態で確かめる）
      await page.reload();
    }
  });

  test("11.2: 600px 以下で、接続先を選べ、接続の操作が画面の中にある", async ({ watchedPage: page }) => {
    await setWidth(page, TABLET);
    await loginDashboard(page);
    const radio = page.getByRole("radio").first();
    await radio.click();
    await expect(radio).toBeChecked();
    const connect = page.getByRole("button", { name: "接続", exact: true });
    await expect(connect).toBeVisible();
    const box = await connect.boundingBox();
    expect(box, "接続ボタンの位置が取得できない").not.toBeNull();
    // 接続ボタンは画面の幅の中に収まっている（横に隠れていない）
    expect((box?.x ?? 0) + (box?.width ?? 0), "接続ボタンが画面の右外にある").toBeLessThanOrEqual(TABLET);
  });

  test("11.3: 600px・420px でページ全体に横スクロールが出ない", async ({ watchedPage: page }) => {
    for (const width of [TABLET, PHONE]) {
      await setWidth(page, width);
      await loginDashboard(page);
      await expectNoHorizontalScroll(page, width);
      await openSettings(page);
      await expectNoHorizontalScroll(page, width);
      await page.keyboard.press("Escape");
      await page.reload();
    }
  });

  test("11.4: 600px 以下で、設定ダイアログの全タブを横スクロールで選べる", async ({ watchedPage: page }) => {
    await setWidth(page, TABLET);
    await loginDashboard(page);
    const dialog = await openSettings(page);
    // 一番右のタブ（メンテナンス）を、横スクロールで表示して選ぶ
    const last = dialog.getByRole("tab", { name: "メンテナンス" });
    await last.click();
    await expect(last).toHaveAttribute("aria-selected", "true");
    // 一番左のタブ（通信制御）へ戻れる
    const first = dialog.getByRole("tab", { name: "通信制御" });
    await first.click();
    await expect(first).toHaveAttribute("aria-selected", "true");
  });

  test("11.5: 420px 以下で、通知が画面の下部に出る", async ({ watchedPage: page, pageErrors }) => {
    // VPN のログインを誤った資格情報で行う。誤りの応答は、通知（エラー）として画面に出る（この試験の意図した結果）
    pageErrors.allow(/status of 4\d\d/);
    await setWidth(page, PHONE);
    await loginDashboard(page);
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await page.getByLabel("ユーザー名").fill("wrong-user");
    await page.getByLabel("パスワード", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();

    const toast = page.locator(".toast-region [role=alert]").first();
    await expect(toast).toBeVisible();
    const box = await toast.boundingBox();
    const viewport = page.viewportSize();
    expect(box, "通知の位置が取得できない").not.toBeNull();
    // 通知は画面の下半分（下部）にある
    expect((box?.y ?? 0) + (box?.height ?? 0), "通知が画面の下部にない").toBeGreaterThan((viewport?.height ?? 0) / 2);
  });
});
