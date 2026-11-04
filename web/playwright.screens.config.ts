// 責務: 画面確認（実ブラウザ）の実行設定。ビルド済みの web を vite preview で配信し、API は試験側でモックする。
// compose スタックは使わない（テーマの見た目と取得の挙動だけを確かめるため）。

import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./tests/screens",
  // 画面確認はテーマごとのスクリーンショットを残す（CI の e2e/hosted とは別の成果物の置き場）。
  outputDir: "../e2e/artifacts/screens/test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
