// 責務: VPNクライアントへのログインを代行する。apiserver/design.md「APIエンドポイント一覧」`POST /v1/session`に対応する。
// 実CLIのログインはブラウザでの認証完了を待つ長時間処理のため、ログインURLが出力された時点で応答を返し、
// 認証待ちのCLIプロセスはプロキシコンテナ側でバックグラウンド実行を継続させる
// （proxyserver/design.md「実VPNベンダーCLI統合・ログイン代行 (Phase 2)」参照）。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { SessionResponseSchema } from "../schemas/session.js";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { loadVendorProfile } from "../profile/profile-loader.js";
import { resolveArgv } from "../profile/placeholder-resolver.js";
import { extractLoginUrl } from "../profile/response-parser.js";
import { executeVendorCommand } from "../proxy-client/proxy-client.js";
import { CommandExecutionError } from "../errors.js";
import { appendAuditLog } from "../audit-log/audit-log-store.js";
import { stripAnsi } from "../lib/strip-ansi.js";

export const registerSessionRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post(
    "/v1/session",
    {
      schema: {
        response: {
          200: SessionResponseSchema,
          422: ErrorResponseSchema,
          502: ErrorResponseSchema,
          504: ErrorResponseSchema,
        },
      },
    },
    async () => {
      const profile = loadVendorProfile();
      const loginAction = profile.actions.login;
      const argv = resolveArgv(profile, "login", {});

      const result = await executeVendorCommand({
        vendor: profile.vendor,
        binary: profile.binary,
        resolvedArgv: argv,
        timeoutMs: loginAction.timeoutMs,
        completionPattern: loginAction.completionPattern,
      });

      // exitCode=nullは「completionPatternに一致し応答した時点ではプロセスが実行継続中」を表す。
      // 監査ログのexitCodeは実際の終了コードのみを記録する数値項目のため、その場合は記録しない
      // （後続の`status`呼び出しの監査ログで実際の結果が記録される）。
      appendAuditLog({ action: "login", exitCode: result.exitCode ?? undefined });

      if (result.exitCode === null) {
        // completionPattern（ログインURLの出力パターン）に一致した時点。CLIプロセスはプロキシ側で認証待ちを継続する。
        return {
          loginUrl: extractLoginUrl(result.stdout),
          message: "表示されたURLをブラウザで開いてログインを完了してください。",
        };
      }

      if (result.exitCode !== 0) {
        throw new CommandExecutionError("login command failed", result.exitCode, result.stderr);
      }

      // completionPatternに一致せずプロセスが正常終了した場合（既にログイン済み等）。
      const message = stripAnsi(result.stdout).trim();
      return { message: message.length > 0 ? message : "既にログインしています。" };
    },
  );
};
