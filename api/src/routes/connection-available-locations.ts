// 責務: 契約プランで接続できる接続先（国・都市）の参考一覧の取得（GET）。
// 接続先を選べないプラン（Proton VPN無料版）で、自動接続の行き先の候補を画面に出すために使う。
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { getActiveProvider } from "../providers/active-provider-store.js";
import { getSessionInfo } from "../session/session-probe.js";
import { readPlanLocations } from "../locations/plan-locations.js";
import { join } from "node:path";

const AvailableLocationsResponseSchema = Type.Object({
  locations: Type.Array(Type.Object({ code: Type.String(), name: Type.String(), cities: Type.Array(Type.String()) })),
});

export const registerConnectionAvailableLocationsRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/connection/available-locations",
    { schema: { response: { 200: AvailableLocationsResponseSchema } } },
    async () => {
      const provider = getActiveProvider();
      const session = await getSessionInfo(provider);
      // 現在のプランが一覧の出典を持つ場合だけ返す（持たない・プラン不明・未ログインなら空）。
      const planId = session.plan?.id;
      const source = provider.profile.actions.account?.plans.find((plan) => plan.id === planId)?.availableLocations;
      if (source === undefined) return { locations: [] };
      const cacheDir = process.env.PROVIDER_CACHE_DIR ?? "/var/lib/vpngwgui-provider-cache";
      return { locations: readPlanLocations(source, join(cacheDir, provider.id)) };
    },
  );
};
