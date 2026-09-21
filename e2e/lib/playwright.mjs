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

/**
 * ヘッドレスChromiumを起動し、指定URLのページを返す。
 * Input: baseUrl（例: "http://10.231.5.23:8080"）
 * Output: { browser, page }（呼び出し側がbrowser.close()する責務を持つ）
 * Example: const { browser, page } = await launch("http://10.231.5.23:8080");
 */
export async function launch(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: baseUrl });
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
