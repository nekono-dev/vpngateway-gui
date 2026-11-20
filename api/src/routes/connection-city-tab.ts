// 責務: 有効なプロバイダの都市一覧タブを取得・保存する。
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { CityTabResponseSchema, CityTabSchema } from "../schemas/location.js";
import { readCityTab, saveCityTab } from "../locations/city-tab-store.js";
import { getActiveProvider } from "../providers/active-provider-store.js";

const CityTabRequestSchema = Type.Object({ tab: CityTabSchema }, { additionalProperties: false });

export const registerConnectionCityTabRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/connection/city-tab",
    { schema: { response: { 200: CityTabResponseSchema } } },
    async () => ({ tab: readCityTab(getActiveProvider().id) }),
  );

  fastify.put(
    "/v1/connection/city-tab",
    {
      schema: {
        body: CityTabRequestSchema,
        response: { 200: CityTabResponseSchema, 400: ErrorResponseSchema },
      },
    },
    async (request) => {
      const providerId = getActiveProvider().id;
      saveCityTab(providerId, request.body.tab);
      return { tab: readCityTab(providerId) };
    },
  );
};
