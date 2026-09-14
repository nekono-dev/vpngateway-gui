import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// devサーバでは/api/*をAPIコンテナへプロキシする（本番はweb/server/index.tsのFastifyが同役割を担う）。
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
});
