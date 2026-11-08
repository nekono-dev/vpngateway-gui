// 責務: 利用者の場所（距離の基点の国）の取得・保存・既定へ戻す（GET/PUT/DELETE /v1/user-location）。
// 認可は既定の preHandler（運用者のセッション）に任せる（未ログインは 401）。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { UserLocationResponseSchema, UserLocationUpdateBodySchema, type UserLocationResponse } from "../schemas/user-location.js";
import { getGeoIndex } from "../geo/geo-index.js";
import { clearSavedUserCountry, readSavedUserCountry, saveUserCountry } from "../locations/user-location-store.js";
import { resolveUserLocation } from "../locations/user-location-resolver.js";

/**
 * 目的: 応答を組み立てる（保存された値・この要求の Accept-Language で決めた実効の国・国の選択肢）。
 * 入力: acceptLanguage（要求の Accept-Language。省略可）。
 * 出力: UserLocationResponse。
 */
function buildResponse(acceptLanguage: string | undefined): UserLocationResponse {
  const geo = getGeoIndex();
  const saved = readSavedUserCountry();
  const resolved = resolveUserLocation({
    saved,
    acceptLanguage,
    isKnownCountry: (code) => geo.hasCountry(code),
  });
  return {
    ...(saved === undefined ? {} : { saved }),
    ...(resolved.country === undefined ? {} : { effective: resolved.country }),
    source: resolved.source,
    countries: [...geo.countryOptions()],
  };
}

export const registerUserLocationRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/user-location",
    {
      schema: {
        response: { 200: UserLocationResponseSchema, 401: ErrorResponseSchema },
      },
    },
    async (request) => buildResponse(request.headers["accept-language"]),
  );

  fastify.put(
    "/v1/user-location",
    {
      schema: {
        body: UserLocationUpdateBodySchema,
        response: { 200: UserLocationResponseSchema, 400: ErrorResponseSchema, 401: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const country = request.body.country.toUpperCase();
      if (!getGeoIndex().hasCountry(country)) {
        reply.code(400);
        return { error: "unknown_country", message: "利用者の場所として選べない国です" };
      }
      saveUserCountry(country);
      return buildResponse(request.headers["accept-language"]);
    },
  );

  fastify.delete(
    "/v1/user-location",
    {
      schema: {
        response: { 200: UserLocationResponseSchema, 401: ErrorResponseSchema },
      },
    },
    async (request) => {
      clearSavedUserCountry();
      return buildResponse(request.headers["accept-language"]);
    },
  );
};
