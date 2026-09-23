// 責務: E2Eスクリプト共通のPlaywright読み込みとブラウザ起動ヘルパー。
// Playwrightはリポジトリの依存に含めず、テスト実行ホストにグローバルインストールされたものを使う
// （`npm root -g`配下）。ESMからグローバルモジュールを読むためcreateRequireを経由する。
//
// 使用例: const { chromium, launch, assert } = await import("../lib/playwright.mjs");

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";

const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const require = createRequire(path.join(globalRoot, "noop.js"));
export const { chromium } = require("playwright");

// Phase 25で追加したWeb UI利用者認証のE2E共通アカウント。`launch()`が毎回、初回のみ初期設定・
// 以後はログインを自動で済ませてからページを返す（各phaseのE2Eスクリプト側の変更を不要にするため）。
export const E2E_USERNAME = "e2e-admin";
export const E2E_PASSWORD = "e2e-password-1234";

/**
 * 目的: 初期設定画面またはログイン画面が表示されている場合に、E2E共通アカウントで突破する。
 * 入力: page(launch()が返すPlaywrightのPage)。
 * 出力: なし。ダッシュボードのヘッダーが表示されるまで待つ（失敗時は例外でスクリプトを止める）。
 */
async function signInIfNeeded(page) {
  const usernameInput = page.getByLabel("ユーザー名");
  const alreadyOnDashboard = await page
    .getByRole("heading", { name: "VPNGateway-GUI" })
    .isVisible()
    .catch(() => false);
  if (alreadyOnDashboard) {
    return;
  }
  await usernameInput.waitFor({ state: "visible", timeout: 15000 });
  await usernameInput.fill(E2E_USERNAME);
  const passwordInputs = page.locator('input[type="password"]');
  if ((await passwordInputs.count()) >= 2) {
    // 初期設定画面（パスワード・パスワード確認の2つ）。
    await passwordInputs.nth(0).fill(E2E_PASSWORD);
    await passwordInputs.nth(1).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "設定する" }).click();
  } else {
    // ログイン画面。
    await passwordInputs.nth(0).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "ログイン" }).click();
  }
  await page.getByRole("heading", { name: "VPNGateway-GUI" }).waitFor({ timeout: 15000 });
}

/**
 * ヘッドレスChromiumを起動し、指定URLのページを返す。Phase 25以降は、初期設定画面・ログイン画面を
 * E2E共通アカウント（E2E_USERNAME・E2E_PASSWORD）で自動的に突破してからダッシュボードのページを返す。
 * Input: baseUrl（例: "http://10.231.5.23:8080"）
 * Output: { browser, page }（呼び出し側がbrowser.close()する責務を持つ）
 * Example: const { browser, page } = await launch("http://10.231.5.23:8080");
 */
export async function launch(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: baseUrl });
  await page.goto("/");
  await signInIfNeeded(page);
  return { browser, page };
}

/**
 * 条件が偽なら例外を投げる。成功時は「PASS: 説明」を標準出力へ出す。
 * Input: condition（真偽値）, description（検証内容）
 * Output: なし（失敗時は例外でスクリプトを異常終了させ、E2E失敗として検知させる）
 * Example: assert(text.includes("接続中"), "接続中表示に切り替わる");
 */
export function assert(condition, description) {
  if (!condition) throw new Error(`FAIL: ${description}`);
  console.log(`PASS: ${description}`);
}
