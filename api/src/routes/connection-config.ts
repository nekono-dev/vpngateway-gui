// 責務: ユーザ向け設定の取得・更新。apiserver/design.md`GET/PUT /v1/connection/config`に対応する。
// Phase 1では永続化のみ行い、プロキシへの実反映（nftables操作等）はPhase 2以降で行う。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { UserSettingsSchema, UserSettingsPatchSchema } from "../schemas/settings.js";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { getSettings, updateSettings } from "../settings/settings-store.js";

export const registerConnectionConfigRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/connection/config",
    { schema: { response: { 200: UserSettingsSchema } } },
    async () => getSettings(),
  );

  fastify.put(
    "/v1/connection/config",
    {
      schema: {
        body: UserSettingsPatchSchema,
        response: { 200: UserSettingsSchema, 400: ErrorResponseSchema },
      },
    },
    async (request) => updateSettings(request.body),
  );
};
