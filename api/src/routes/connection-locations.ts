// 責務: 接続先（ロケーション）の一覧取得と、お気に入りの登録・解除。
//一覧はベンダーCLIの`list-locations`をその都度実行して返す。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import {
  FavoriteResponseSchema,
  LocationIdParamsSchema,
  LocationsResponseSchema,
} from "../schemas/location.js";
import { fetchLocations } from "../locations/location-fetcher.js";
import { getActiveProvider } from "../providers/active-provider-store.js";
import {
  addFavoriteLocation,
  readFavoriteLocationIds,
  removeFavoriteLocation,
} from "../locations/favorite-locations-store.js";
import { readLastLocationId } from "../locations/last-location-store.js";
import { isPingMeasurable } from "../capabilities/capability-evaluator.js";
import { getGeoIndex } from "../geo/geo-index.js";
import { annotateDistances } from "../locations/distance-annotator.js";
import { readSavedUserCountry } from "../locations/user-location-store.js";
import { resolveUserLocation } from "../locations/user-location-resolver.js";

export const registerConnectionLocationsRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/connection/locations",
    {
      schema: {
        response: {
          200: LocationsResponseSchema,
          403: ErrorResponseSchema,
          422: ErrorResponseSchema,
          501: ErrorResponseSchema,
          502: ErrorResponseSchema,
          504: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const provider = getActiveProvider();
      const locations = await fetchLocations(provider);
      const favorites = new Set(readFavoriteLocationIds(provider.id));
      const lastId = readLastLocationId(provider.id);
      const geo = getGeoIndex();
      const userLocation = resolveUserLocation({
        saved: readSavedUserCountry(),
        acceptLanguage: request.headers["accept-language"],
        isKnownCountry: (code) => geo.hasCountry(code),
      });
      // 距離の注釈（ping を計測できないときだけ距離順。それ以外は CLI の順序のまま）。
      const annotated = annotateDistances(
        locations.map((location) => ({
          id: location.id,
          country: location.country,
          countryName: location.countryName,
          ...(location.city === undefined ? {} : { city: location.city }),
          ...(location.pingMs === undefined ? {} : { pingMs: location.pingMs }),
          favorite: favorites.has(location.id),
          lastConnected: location.id === lastId,
        })),
        {
          pingMeasurable: isPingMeasurable(provider.profile),
          countryAliases: provider.profile.countryAliases ?? {},
          userCountry: userLocation.country,
        },
        geo,
      );
      // 接続時の指定名（connectName）は内部値のためレスポンスへ含めない。
      return annotated.map(({ distanceKm, ...row }) => (distanceKm === undefined ? row : { ...row, distanceKm }));
    },
  );

  // 登録・解除は冪等。`id`が現在の一覧に存在するかは確認しない（CLIを実行せず即応答するため。
  // 形式不正・上限超過のみ400）。
  fastify.put(
    "/v1/connection/locations/:locationId/favorite",
    {
      schema: {
        params: LocationIdParamsSchema,
        response: { 200: FavoriteResponseSchema, 400: ErrorResponseSchema },
      },
    },
    async (request) => {
      addFavoriteLocation(getActiveProvider().id, request.params.locationId);
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
      removeFavoriteLocation(getActiveProvider().id, request.params.locationId);
      return { locationId: request.params.locationId, favorite: false };
    },
  );
};
