// 責務: リポジトリ直下 `tests/` の受け入れテスト（vitest）の設定。
// 受け入れ条件（`specs/<spec名>/requirements.md`のAC-n）ごとに、テスト名へ「<spec名>/AC-n」を付けて実行する。
// 各アプリケーション内の単体テスト（`api/src`・`proxy/src`・`web/src`）とは別に、spec単位の合否を判定する。
// Webサーバのコンポーネントのテスト（拡張子 .test.tsx）だけ jsdom で動かす。Playwright の E2E（`tests/e2e`）は対象外（別コマンド）。

import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: repoRoot,
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**"],
    environment: "node",
    environmentMatchGlobs: [["tests/webserver/**/*.test.tsx", "jsdom"]],
    setupFiles: ["web/src/test-setup.ts"],
    testTimeout: 30000,
    // ゲートウェイの代役・APIサーバなどが標準出力へ出す構造化ログで、結果の表示が埋もれないようにする。
    silent: true,
  },
});
