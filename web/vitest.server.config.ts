// 責務: web のサーバ側コード（server/）のテストの設定。コンポーネントテスト（jsdom、src/）とは分ける。
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
  },
});
