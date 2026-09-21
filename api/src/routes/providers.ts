// 責務: 有効なベンダーの一覧の取得と、使うベンダーの切替。
// apiserver/design.md「ベンダーの選択」`GET /v1/providers`・`PUT /v1/providers/active`に対応する。
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { ActiveProviderBodySchema, ActiveProviderSchema, ProvidersResponseSchema } from "../schemas/providers.js";
import { getActiveProvider } from "../providers/active-provider-store.js";
import { getProviders } from "../providers/provider-registry.js";
import { switchProvider } from "../providers/provider-switcher.js";
import { checkRunnerHealth } from "../proxy-client/proxy-client.js";

export const registerProvidersRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/providers",
    { schema: { response: { 200: ProvidersResponseSchema } } },
    async () => {
      const activeId = getActiveProvider().id;
      // 各ランナーへの問い合わせは並行して行う（一覧の応答を、停止したランナー1つのタイムアウトで遅くしないため）。
      return Promise.all(
        getProviders().map(async (provider) => {
          const available = await checkRunnerHealth(provider.id);
          return {
            id: provider.id,
            displayName: provider.displayName,
            active: provider.id === activeId,
            available,
            ...(available ? {} : { unavailableReason: "ランナーが起動していません" }),
          };
        }),
      );
    },
  );

  fastify.put(
    "/v1/providers/active",
    {
      schema: {
        body: ActiveProviderBodySchema,
        response: {
          200: ActiveProviderSchema,
          400: ErrorResponseSchema,
          409: ErrorResponseSchema,
          422: ErrorResponseSchema,
          502: ErrorResponseSchema,
          504: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const provider = await switchProvider(request.body.providerId);
      return { id: provider.id, displayName: provider.displayName };
    },
  );
};
