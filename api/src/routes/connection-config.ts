// 責務: ユーザ向け設定の取得・更新。apiserver/design.md`GET/PUT /v1/connection/config`に対応する。
// Phase 3以降、更新後にプロキシの内部エンドポイント`POST /settings`へ最新の設定全体を通知し、
// nftables等への実反映（透過ゲートウェイ・Kill Switch）を即時に要求する（proxyserver/design.md
// 「内部プロトコル拡張」参照）。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { UserSettingsSchema, UserSettingsPatchSchema } from "../schemas/settings.js";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { getSettings, updateSettings } from "../settings/settings-store.js";
import { notifySettings } from "../proxy-client/proxy-client.js";

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
    async (request) => {
      const next = updateSettings(request.body);
      // 永続化は既に成功しているため、プロキシへの通知失敗（プロキシ未起動等）でPUT自体を失敗させない
      // （設定は保存されており、プロキシ復旧後の次回通知・監視ループで追従できるため）。
      // 失敗はログにのみ残し、ユーザには更新後の設定をそのまま返す。
      try {
        await notifySettings(next);
      } catch (error) {
        request.log.warn({ error }, "failed to notify settings to proxy");
      }
      return next;
    },
  );
};
