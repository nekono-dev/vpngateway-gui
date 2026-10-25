// 責務: 実ブラウザ（Playwright）のテストの設定。Webの開発サーバを各テストファイルが自分で起動し、APIはブラウザ側で差し替える。
// 実行: `NODE_PATH=$(npm root -g) playwright test -c tests/e2e/playwright.config.ts`
// （Playwrightはリポジトリの依存に含めず、実行ホストにグローバルに導入されたものを使う）。

import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  workers: 1,
  reporter: "line",
  use: { browserName: "chromium", headless: true, ignoreHTTPSErrors: true },
});
