import { defineConfig } from "orval";

// APIサーバが自動生成するOpenAPI仕様（api/scripts/export-openapi.tsで書き出し）を入力とする。
// Webサーバの実装コードは、この生成クライアント以外の手段でAPIサーバへリクエストを送信してはならない
// （webserver/design.md「APIクライアント生成方針」参照）。
export default defineConfig({
  vpnGatewayApi: {
    input: "../api/openapi.json",
    output: {
      mode: "tags-split",
      target: "src/generated/api/endpoints.ts",
      client: "fetch",
      baseUrl: "/api",
    },
  },
});
