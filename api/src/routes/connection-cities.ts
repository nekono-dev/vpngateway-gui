// 責務: 国ごとの都市一覧を遅延取得・保存し、距離とお気に入りを付けて返す。
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { executeVendorCommand } from "../proxy-client/proxy-client.js";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { CityRowSchema } from "../schemas/location.js";
import { getActiveProvider } from "../providers/active-provider-store.js";
import { requireAction } from "../profile/require-action.js";
import { resolveArgv } from "../profile/placeholder-resolver.js";
import { readCityList, saveCityList } from "../locations/city-cache-store.js";
import { parseCityList } from "../locations/city-list-parser.js";
import { throwCommandFailure } from "../capabilities/restriction-learner.js";
import { pickFailureOutput } from "../lib/failure-output.js";
import { readFavoriteLocations } from "../locations/favorite-locations-store.js";
import { readLastLocationId } from "../locations/last-location-store.js";
import { isPingMeasurable } from "../capabilities/capability-evaluator.js";
import { getGeoIndex } from "../geo/geo-index.js";
import { annotateDistances } from "../locations/distance-annotator.js";
import { readSavedUserCountry } from "../locations/user-location-store.js";
import { resolveUserLocation } from "../locations/user-location-resolver.js";
import { toLocationId } from "../locations/location-id.js";

const ParamsSchema = Type.Object({ country: Type.String({ pattern: "^[a-z]{2}$" }) });
const COUNTRY_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

export const registerConnectionCitiesRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/connection/locations/:country/cities",
    { schema: { params: ParamsSchema, response: { 200: Type.Array(CityRowSchema), 403: ErrorResponseSchema, 422: ErrorResponseSchema, 502: ErrorResponseSchema, 504: ErrorResponseSchema } } },
    async (request) => {
      const provider = getActiveProvider();
      const country = request.params.country;
      let cities = readCityList(provider.id, country);
      if (cities === undefined) {
        const action = requireAction(provider.profile, "listCities");
        const code = country.toUpperCase();
        const argv = resolveArgv(provider.profile, "listCities", { LOCATION: code }, { LOCATION: [code] });
        const result = await executeVendorCommand(provider.id, {
          vendor: provider.profile.vendor,
          binary: provider.profile.binary,
          resolvedArgv: argv,
          timeoutMs: action.timeoutMs,
        });
        if (result.exitCode !== 0) {
          const connectAction = provider.profile.actions.connect;
          throwCommandFailure(provider.id, "city list command failed", result.exitCode ?? -1,
            pickFailureOutput(result.stderr, result.stdout), {
              pattern: connectAction?.restrictedPattern,
              operation: "connectToLocation",
            });
        }
        cities = parseCityList(result.stdout, action.table);
        saveCityList(provider.id, country, cities);
      }

      const geo = getGeoIndex();
      const userLocation = resolveUserLocation({
        saved: readSavedUserCountry(),
        acceptLanguage: request.headers["accept-language"],
        isKnownCountry: (code) => geo.hasCountry(code),
      });
      const countryName = COUNTRY_NAMES.of(country.toUpperCase()) ?? country.toUpperCase();
      const favorites = new Set(readFavoriteLocations(provider.id).filter((item) => item.kind === "city").map((item) => item.id));
      const lastId = readLastLocationId(provider.id);
      const rows = cities.map((city) => {
        const id = toLocationId(country, city);
        return { id, country, countryName, city, favorite: favorites.has(id), lastConnected: lastId === id };
      });
      return annotateDistances(rows, {
        pingMeasurable: isPingMeasurable(provider.profile),
        countryAliases: provider.profile.countryAliases ?? {},
        userCountry: userLocation.country,
      }, geo);
    },
  );

  fastify.post(
    "/v1/connection/locations/:country/cities/refresh",
    { schema: { params: ParamsSchema, response: { 200: Type.Array(CityRowSchema), 403: ErrorResponseSchema, 422: ErrorResponseSchema, 502: ErrorResponseSchema, 504: ErrorResponseSchema } } },
    async (request) => {
      const provider = getActiveProvider();
      const country = request.params.country;
      const action = requireAction(provider.profile, "listCities");
      const code = country.toUpperCase();
      const argv = resolveArgv(provider.profile, "listCities", { LOCATION: code }, { LOCATION: [code] });
      const result = await executeVendorCommand(provider.id, {
        vendor: provider.profile.vendor,
        binary: provider.profile.binary,
        resolvedArgv: argv,
        timeoutMs: action.timeoutMs,
      });
      if (result.exitCode !== 0) {
        const connectAction = provider.profile.actions.connect;
        throwCommandFailure(provider.id, "city list command failed", result.exitCode ?? -1,
          pickFailureOutput(result.stderr, result.stdout), {
            pattern: connectAction?.restrictedPattern,
            operation: "connectToLocation",
          });
      }
      const cities = parseCityList(result.stdout, action.table);
      saveCityList(provider.id, country, cities);

      const geo = getGeoIndex();
      const userLocation = resolveUserLocation({
        saved: readSavedUserCountry(),
        acceptLanguage: request.headers["accept-language"],
        isKnownCountry: (countryCode) => geo.hasCountry(countryCode),
      });
      const countryName = COUNTRY_NAMES.of(country.toUpperCase()) ?? country.toUpperCase();
      const favorites = new Set(readFavoriteLocations(provider.id).filter((item) => item.kind === "city").map((item) => item.id));
      const lastId = readLastLocationId(provider.id);
      const rows = cities.map((city) => {
        const id = toLocationId(country, city);
        return { id, country, countryName, city, favorite: favorites.has(id), lastConnected: lastId === id };
      });
      return annotateDistances(rows, {
        pingMeasurable: isPingMeasurable(provider.profile),
        countryAliases: provider.profile.countryAliases ?? {},
        userCountry: userLocation.country,
      }, geo);
    },
  );
};
