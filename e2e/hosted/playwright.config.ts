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
    // Service Worker（/sw.js）の取得は ignoreHTTPSErrors の対象外のため、ブラウザの起動引数でも証明書の警告を無視する。
    // 製品の Service Worker の登録失敗は握りつぶされる（web/src/main.tsx）。試験の対象は画面の挙動である
    launchOptions: { args: ["--ignore-certificate-errors"] },
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
