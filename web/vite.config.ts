import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// devサーバでは/api/*をAPIコンテナへプロキシする（本番はweb/server/index.tsのFastifyが同役割を担う）。
// testはコンポーネントテスト用（jsdom）。サーバ側コード（web/server）のテストは対象外。
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.API_ORIGIN ?? "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
