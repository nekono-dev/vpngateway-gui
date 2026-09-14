// 責務: 現在の接続状態取得（GET）と接続/切断の制御（PUT）。
// apiserver/design.md「APIエンドポイント一覧」`GET/PUT /v1/connection`に対応する。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  ConnectionStatusSchema,
  ConnectionPutBodySchema,
  ErrorResponseSchema,
} from "../schemas/connection.js";
import { loadVendorProfile } from "../profile/profile-loader.js";
import { resolveArgv, PlaceholderValidationError } from "../profile/placeholder-resolver.js";
import { parseConnectionOutput } from "../profile/response-parser.js";
import { executeVendorCommand } from "../proxy-client/proxy-client.js";
import { CommandExecutionError } from "../errors.js";
import { appendAuditLog } from "../audit-log/audit-log-store.js";

export const registerConnectionRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/connection",
    {
      schema: {
        response: {
          200: ConnectionStatusSchema,
          502: ErrorResponseSchema,
          504: ErrorResponseSchema,
        },
      },
    },
    async () => {
      const profile = loadVendorProfile();
      const argv = resolveArgv(profile, "status", {});
      const result = await executeVendorCommand({
        vendor: profile.vendor,
        binary: profile.binary,
        resolvedArgv: argv,
        timeoutMs: profile.actions.status.timeoutMs,
      });
      // status/connect/disconnectはcompletionPatternを指定しないため、exitCodeがnull
      // （プロセス実行継続中）になることはない。念のため-1（既存のタイムアウト表現）へ正規化する。
      const exitCode = result.exitCode ?? -1;
      if (exitCode !== 0) {
        throw new CommandExecutionError("status command failed", exitCode, result.stderr);
      }
      return parseConnectionOutput(profile.outputFormat, result.stdout);
    },
  );

  fastify.put(
    "/v1/connection",
    {
      schema: {
        body: ConnectionPutBodySchema,
        response: {
          200: ConnectionStatusSchema,
          400: ErrorResponseSchema,
          422: ErrorResponseSchema,
          502: ErrorResponseSchema,
          504: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const profile = loadVendorProfile();
      const body = request.body;

      const actionName = body.connect ? "connect" : "disconnect";
      if (body.connect && !body.country) {
        throw new PlaceholderValidationError("country is required when connect=true");
      }
      const argv = resolveArgv(profile, actionName, body.country ? { COUNTRY: body.country } : {});

      const result = await executeVendorCommand({
        vendor: profile.vendor,
        binary: profile.binary,
        resolvedArgv: argv,
        timeoutMs: profile.actions[actionName].timeoutMs,
      });

      // connect/disconnectはcompletionPatternを指定しないため、exitCodeがnull（プロセス実行継続中）
      // になることはない。念のため-1（既存のタイムアウト表現）へ正規化する。
      const exitCode = result.exitCode ?? -1;
      appendAuditLog({ action: actionName, input: body, exitCode });

      if (exitCode !== 0) {
        throw new CommandExecutionError(`${actionName} command failed`, exitCode, result.stderr);
      }
      return parseConnectionOutput(profile.outputFormat, result.stdout);
    },
  );
};
