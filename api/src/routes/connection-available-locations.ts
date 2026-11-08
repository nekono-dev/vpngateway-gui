// 責務: 契約プランで接続できる接続先（国・都市）の参考一覧の取得（GET）。
// 接続先を選べないプラン（無料プラン等）で、自動接続の行き先の候補を画面に出すために使う。
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { getActiveProvider } from "../providers/active-provider-store.js";
import { getSessionInfo } from "../session/session-probe.js";
import { readPlanLocations } from "../locations/plan-locations.js";
import { join } from "node:path";
import { isPingMeasurable } from "../capabilities/capability-evaluator.js";
import { getGeoIndex } from "../geo/geo-index.js";
import { annotateDistances } from "../locations/distance-annotator.js";
import { readSavedUserCountry } from "../locations/user-location-store.js";
import { resolveUserLocation } from "../locations/user-location-resolver.js";

const AvailableLocationsResponseSchema = Type.Object({
  locations: Type.Array(
    Type.Object({
      code: Type.String(),
      name: Type.String(),
      cities: Type.Array(Type.String()),
      // 利用者の国の首都からの距離（km。小数点以下第一位）。ping を計測できないプロバイダで、距離が決まった国のみ付く。
      distanceKm: Type.Optional(Type.Number()),
    }),
  ),
});

export const registerConnectionAvailableLocationsRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/connection/available-locations",
    { schema: { response: { 200: AvailableLocationsResponseSchema } } },
    async (request) => {
      const provider = getActiveProvider();
      const session = await getSessionInfo(provider);
      // 現在のプランが一覧の出典を持つ場合だけ返す（持たない・プラン不明・未ログインなら空）。
      const planId = session.plan?.id;
      const source = provider.profile.actions.account?.plans.find((plan) => plan.id === planId)?.availableLocations;
      if (source === undefined) return { locations: [] };
      const cacheDir = process.env.PROVIDER_CACHE_DIR ?? "/var/lib/vpngwgui-provider-cache";
      const planLocations = readPlanLocations(source, join(cacheDir, provider.id));
      const geo = getGeoIndex();
      const userLocation = resolveUserLocation({
        saved: readSavedUserCountry(),
        acceptLanguage: request.headers["accept-language"],
        isKnownCountry: (code) => geo.hasCountry(code),
      });
      // 参考一覧は国の行だけ（お気に入りの先頭配置は適用しない）。距離の注釈は一覧と同じ規則。
      const annotated = annotateDistances(
        planLocations.map((location) => ({ country: location.code, favorite: false, name: location.name, cities: location.cities })),
        {
          pingMeasurable: isPingMeasurable(provider.profile),
          countryAliases: provider.profile.countryAliases ?? {},
          userCountry: userLocation.country,
        },
        geo,
      );
      return {
        locations: annotated.map(({ country, favorite: _favorite, distanceKm, ...location }) =>
          distanceKm === undefined ? { code: country, ...location } : { code: country, ...location, distanceKm },
        ),
      };
    },
  );
};
