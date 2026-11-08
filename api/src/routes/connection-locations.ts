// 責務: 接続先（ロケーション）の一覧取得と、お気に入りの登録・解除。
//一覧はベンダーCLIの`list-locations`をその都度実行して返す。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import {
  FavoriteResponseSchema,
  FavoriteItemRequestSchema,
  FavoritesResponseSchema,
  LocationIdParamsSchema,
  LocationsResponseSchema,
  type FavoriteItem,
} from "../schemas/location.js";
import { LOCATION_ID_PATTERN, toServerLocationId } from "../locations/location-id.js";
import { fetchLocations } from "../locations/location-fetcher.js";
import { getActiveProvider } from "../providers/active-provider-store.js";
import {
  FavoriteLocationsError,
  addFavoriteLocationItem,
  readFavoriteLocations,
  readFavoriteLocationIds,
  removeFavoriteLocation,
} from "../locations/favorite-locations-store.js";
import { readLastLocationId } from "../locations/last-location-store.js";
import { isPingMeasurable } from "../capabilities/capability-evaluator.js";
import { getGeoIndex } from "../geo/geo-index.js";
import { annotateDistances } from "../locations/distance-annotator.js";
import { readSavedUserCountry } from "../locations/user-location-store.js";
import { resolveUserLocation } from "../locations/user-location-resolver.js";

function validateFavoriteItem(body: {
  id: string;
  kind: "city" | "server";
  country: string;
  countryName: string;
  city: string;
  serverName?: string;
}): FavoriteItem {
  const validLocationId = new RegExp(LOCATION_ID_PATTERN).test(body.id);
  if (body.kind === "city") {
    if (!validLocationId || body.id.startsWith("srv-") || body.serverName !== undefined) {
      throw new FavoriteLocationsError("favorite kind and id do not match");
    }
    return { id: body.id, kind: "city", country: body.country, countryName: body.countryName, city: body.city };
  }

  if (typeof body.serverName !== "string" || body.serverName.length === 0) {
    throw new FavoriteLocationsError("favorite kind and server name do not match");
  }
  if (!validLocationId || !body.id.startsWith("srv-") || body.id !== toServerLocationId(body.serverName)) {
    throw new FavoriteLocationsError("favorite server id does not match server name");
  }
  return {
    id: body.id,
    kind: "server",
    country: body.country,
    countryName: body.countryName,
    city: body.city,
    serverName: body.serverName,
  };
}

export const registerConnectionLocationsRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/connection/favorites",
    { schema: { response: { 200: FavoritesResponseSchema } } },
    async () => readFavoriteLocations(getActiveProvider().id),
  );

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
        body: FavoriteItemRequestSchema,
        response: { 200: FavoriteResponseSchema, 400: ErrorResponseSchema },
      },
    },
    async (request) => {
      if (request.body.id !== request.params.locationId) {
        throw new FavoriteLocationsError("favorite id does not match location id");
      }
      const item = validateFavoriteItem(request.body);
      addFavoriteLocationItem(getActiveProvider().id, item);
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
