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
    baseURL: "https://127.0.0.1:18080",
    // Web UI の証明書は導入のたびに作る自己署名（製品の仕様）。ブラウザの試験は画面の挙動を確かめる。API の検証は CA で行う
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "smoke", testMatch: /smoke\/.*\.spec\.ts/ },
    { name: "lifecycle", testMatch: /lifecycle\/.*\.spec\.ts/ },
    // stack 群: 初期設定の画面（ui）が最初に実行され、api はその後に実行される（dependencies）
    { name: "stack-ui", testMatch: /ui\/.*\.spec\.ts/ },
    { name: "stack-api", testMatch: /api\/.*\.spec\.ts/, dependencies: ["stack-ui"] },
  ],
});
