// 責務: 透過ゲートウェイ／Kill Switchの実際の稼働状況の取得。apiserver/design.md`GET /v1/connection/gateway`に対応する。
// APIサーバは状態を保持せず、プロキシの内部エンドポイント`GET /status`の結果をそのまま中継する。
// `GET /v1/connection/config`（永続化された設定値）とは別リソース（設定ONでも未構成という乖離を示すため）。
// プロキシ未応答（ProxyUnavailableError/ProxyTimeoutError）はapp.tsのエラーハンドラで502/504になる。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { GatewayStatusSchema } from "../schemas/gateway.js";
import { fetchProxyStatus } from "../proxy-client/proxy-client.js";

export const registerConnectionGatewayRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/connection/gateway",
    { schema: { response: { 200: GatewayStatusSchema, 502: ErrorResponseSchema, 504: ErrorResponseSchema } } },
    async () => fetchProxyStatus(),
  );
};
