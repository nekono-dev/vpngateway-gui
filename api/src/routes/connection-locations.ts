// 責務: 接続先（ロケーション）の一覧取得と、お気に入りの登録・解除。
// apiserver/design.md「接続先（ロケーション）」に対応する。一覧はベンダーCLIの`list-locations`をその都度実行して返す。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import {
  FavoriteResponseSchema,
  LocationIdParamsSchema,
  LocationsResponseSchema,
} from "../schemas/location.js";
import { fetchLocations } from "../locations/location-fetcher.js";
import {
  addFavoriteLocation,
  readFavoriteLocationIds,
  removeFavoriteLocation,
} from "../locations/favorite-locations-store.js";
import { readLastLocationId } from "../locations/last-location-store.js";

export const registerConnectionLocationsRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/connection/locations",
    {
      schema: {
        response: { 200: LocationsResponseSchema, 422: ErrorResponseSchema, 502: ErrorResponseSchema, 504: ErrorResponseSchema },
      },
    },
    async () => {
      const locations = await fetchLocations();
      const favorites = new Set(readFavoriteLocationIds());
      const lastId = readLastLocationId();
      // 接続時の指定名（connectName）は内部値のためレスポンスへ含めない。
      return locations.map((location) => ({
        id: location.id,
        country: location.country,
        countryName: location.countryName,
        city: location.city,
        ...(location.pingMs === undefined ? {} : { pingMs: location.pingMs }),
        favorite: favorites.has(location.id),
        lastConnected: location.id === lastId,
      }));
    },
  );

  // 登録・解除は冪等。`id`が現在の一覧に存在するかは確認しない（CLIを実行せず即応答するため。
  // 形式不正・上限超過のみ400。apiserver/design.md「永続化」）。
  fastify.put(
    "/v1/connection/locations/:locationId/favorite",
    {
      schema: {
        params: LocationIdParamsSchema,
        response: { 200: FavoriteResponseSchema, 400: ErrorResponseSchema },
      },
    },
    async (request) => {
      addFavoriteLocation(request.params.locationId);
      return { locationId: request.params.locationId, favorite: true };
    },
  );

  fastify.delete(
    "/v1/connection/locations/:locationId/favorite",
    {
      schema: {
        params: LocationIdParamsSchema,
        response: { 200: FavoriteResponseSchema, 400: ErrorResponseSchema },
      },
    },
    async (request) => {
      removeFavoriteLocation(request.params.locationId);
      return { locationId: request.params.locationId, favorite: false };
    },
  );
};
