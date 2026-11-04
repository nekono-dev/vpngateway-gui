// 責務: 表示設定（テーマ）の取得・保存。`GET/PUT /v1/ui-preferences` に対応する。
// GET は未ログインでも呼べる（テーマの値だけを返すため。認可の例外は auth/require-operator-session.ts で登録）。
// PUT は管理者のログイン済みセッションを要する（既定の認可で保護する）。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import {
  UiPreferencesSchema,
  UiPreferencesUpdateBodySchema,
} from "../schemas/ui-preferences.js";
import { getUiPreferences, updateUiPreferences } from "../ui-preferences/ui-preferences-store.js";

export const registerUiPreferencesRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/ui-preferences",
    { schema: { response: { 200: UiPreferencesSchema } } },
    async () => getUiPreferences(),
  );

  // 401 は認可の preHandler（requireOperatorSession）が返す。OpenAPI と生成クライアントの型へ反映するため宣言する。
  fastify.put(
    "/v1/ui-preferences",
    {
      schema: {
        body: UiPreferencesUpdateBodySchema,
        response: { 200: UiPreferencesSchema, 400: ErrorResponseSchema, 401: ErrorResponseSchema },
      },
    },
    async (request) => updateUiPreferences(request.body),
  );
};
