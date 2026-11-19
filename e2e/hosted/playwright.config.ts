// 責務: hosted E2E の Playwright の設定。グループ（プロジェクト）ごとに試験を分け、ワーカーは 1 に固定する（要件 1.2・12.3）。
// 成果物は e2e/artifacts/hosted に置く（スクリーンショット・トレース・結果の JSON）。

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: "../artifacts/hosted/test-output",
  // 群ごとに別の JSON へ書く（run.sh が E2E_JSON_OUT を群ごとに与える）
  reporter: [["json", { outputFile: process.env.E2E_JSON_OUT ?? "../artifacts/hosted/playwright.json" }], ["list"]],
  use: {
    baseURL: `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "18080"}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "smoke", testMatch: /specs\/smoke\/.*\.spec\.ts$/ },
    { name: "lifecycle", testMatch: /specs\/lifecycle\/.*\.spec\.ts$/ },
    // stack 群: 初期設定の画面（ui）が最初に実行され、api はその後に実行される（dependencies）
    { name: "stack-ui", testMatch: /specs\/ui\/.*\.spec\.ts$/ },
    { name: "stack-api", testMatch: /specs\/api\/.*\.spec\.ts$/, dependencies: ["stack-ui"] },
    // gateway 群: 透過ゲートウェイ・DNS 中継・明示的プロキシ・動作検証（経路と ISP の模擬を使う）
    { name: "gateway", testMatch: /specs\/gateway\/.*\.spec\.ts$/ },
  ],
});
