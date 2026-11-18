// 責務: ユーザ向け設定の取得・更新。`GET/PUT /v1/connection/config`に対応する。
// Phase 3以降、更新後にプロキシの内部エンドポイント`POST /settings`へ最新の設定全体を通知し、
// nftables等への実反映（透過ゲートウェイ・Kill Switch）を即時に要求する。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { UserSettingsSchema, UserSettingsPatchSchema } from "../schemas/settings.js";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { getSettings, prepareSettingsUpdate, saveSettings, SettingsValidationError, toGatewaySettings } from "../settings/settings-store.js";
import { notifySettings } from "../proxy-client/proxy-client.js";
import { SettingsQueueWaitTimeoutError, settingsNotificationQueue } from "../settings/settings-notification-queue.js";

const QUEUE_WAIT_TIMEOUT_MS = 5000;

class SettingsProxyApplyError extends Error {
  constructor(readonly code: "kill_switch_not_applied" | "gateway_setting_not_applied") {
    super(code);
  }
}

function isGuardEnabled(settings: ReturnType<typeof getSettings>): boolean {
  return settings.killSwitch && settings.transparentGatewayEnabled;
}

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
        response: { 200: UserSettingsSchema, 400: ErrorResponseSchema, 500: ErrorResponseSchema, 503: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return await settingsNotificationQueue.runProjected(async () => {
          // 先行 PUT の保存を反映した最新値から候補を作り、同じキュー区間で通知と保存を確定する。
          const current = getSettings();
          const next = prepareSettingsUpdate(request.body);
          const effectiveGuardChanged = isGuardEnabled(current) !== isGuardEnabled(next);

          if (effectiveGuardChanged) {
            try {
              const result = await notifySettings(toGatewaySettings(next));
              if (!result.applied) throw new Error("proxy did not apply settings");
            } catch {
              throw new SettingsProxyApplyError(current.killSwitch !== next.killSwitch ? "kill_switch_not_applied" : "gateway_setting_not_applied");
            }
            saveSettings(next);
            return next;
          }

          // ガード有効値が変わらない PUT は、既存契約どおり先に保存してから通知する。
          saveSettings(next);
          try {
            await notifySettings(toGatewaySettings(next));
          } catch (error) {
            request.log.warn({ error }, "failed to notify settings to proxy");
          }
          return next;
        },
        (settings) => ({ ...settings, ...request.body }),
        getSettings,
        isGuardEnabled,
        Object.hasOwn(request.body, "killSwitch") || Object.hasOwn(request.body, "transparentGatewayEnabled"),
        QUEUE_WAIT_TIMEOUT_MS,
        (before, after) => before.killSwitch !== after.killSwitch ? "kill_switch_not_applied" : "gateway_setting_not_applied",
        );
      } catch (error) {
        if (error instanceof SettingsProxyApplyError) {
          return reply.code(503).send({ error: error.code });
        }
        if (error instanceof SettingsQueueWaitTimeoutError) {
          return reply.code(503).send({ error: error.errorCode ?? "gateway_setting_not_applied" });
        }
        if (error instanceof SettingsValidationError) {
          return reply.code(400).send({ error: "invalid_input", message: error.message });
        }
        request.log.error({ error }, "failed to persist settings");
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
};
