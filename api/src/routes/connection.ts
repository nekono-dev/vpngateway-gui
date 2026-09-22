// 責務: 現在の接続状態取得（GET）と接続/切断の制御（PUT）。
// apiserver/design.md「APIエンドポイント一覧」`GET/PUT /v1/connection`に対応する。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  ConnectionStatusSchema,
  ConnectionPutBodySchema,
  ErrorResponseSchema,
} from "../schemas/connection.js";
import { getActiveProvider } from "../providers/active-provider-store.js";
import { assertNotSwitching } from "../providers/provider-switcher.js";
import { resolveArgv } from "../profile/placeholder-resolver.js";
import { parseConnectionOutput } from "../profile/response-parser.js";
import { isCommandSuccess } from "../profile/command-success.js";
import { executeVendorCommand } from "../proxy-client/proxy-client.js";
import { CommandExecutionError } from "../errors.js";
import { pickFailureOutput } from "../lib/failure-output.js";
import { reconcileLocation } from "../connection-state/connection-state-store.js";
import { applyConnectionChange } from "../connection-state/apply-connection.js";

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
      const provider = getActiveProvider();
      const { profile } = provider;
      const argv = resolveArgv(profile, "status", {});
      const result = await executeVendorCommand(provider.id, {
        vendor: profile.vendor,
        binary: profile.binary,
        resolvedArgv: argv,
        timeoutMs: profile.actions.status.timeoutMs,
      });
      // status/connect/disconnectはcompletionPatternを指定しないため、exitCodeがnull
      // （プロセス実行継続中）になることはない。念のため-1（既存のタイムアウト表現）へ正規化する。
      const exitCode = result.exitCode ?? -1;
      // 未ログイン時のstatusが非ゼロで終了するCLI向けに、successPatternが定義されていれば
      // 非ゼロexitでも成功とみなす（PUT /v1/connectionのapply-connection.tsと同じ判定。
      // 一致時の出力は「未接続」を示す文言のためparseConnectionOutputが自然にdisconnectedと判定する）。
      if (!isCommandSuccess(profile.actions.status, result)) {
        throw new CommandExecutionError(
          "status command failed",
          exitCode,
          pickFailureOutput(result.stderr, result.stdout),
        );
      }
      return reconcileLocation(provider.id, parseConnectionOutput(profile.outputFormat, result.stdout, profile.output));
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
          403: ErrorResponseSchema,
          422: ErrorResponseSchema,
          501: ErrorResponseSchema,
          502: ErrorResponseSchema,
          504: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      assertNotSwitching();
      const provider = getActiveProvider();
      // 接続先の解決・CLI実行・成否判定・永続化はapplyConnectionChange（Phase 16で切り出し。
      // 起動時の接続復元（restore-connection.ts）と共有する）が行う。
      return applyConnectionChange(provider, request.body);
    },
  );
};
