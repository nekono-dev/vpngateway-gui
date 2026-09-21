// 責務: VPNクライアントのセッション（ログイン状態の取得・ログイン・ログアウト）。
// apiserver/design.md「APIエンドポイント一覧」`GET/POST/DELETE /v1/session`と「セッション（`/v1/session`）の変更」に対応する。
// ログイン方式はプロファイルの`loginMethod`で切り替える:
// - deviceUrl: ブラウザでの認証完了を待つ長時間処理のため、ログインURLが出力された時点で応答を返し、
//   認証待ちのCLIプロセスはプロキシコンテナ側でバックグラウンド実行を継続させる
//   （proxyserver/design.md「実VPNベンダーCLI統合・ログイン代行 (Phase 2)」参照）。
// - credentials: ユーザー名・パスワード（・2FAコード）を受け取り、パスワード等はCLIの標準入力にのみ渡す
//   （コマンド引数・監査ログ・エラー応答・APIのログに残さない）。
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { SessionLoginBodySchema, SessionResponseSchema, SessionStateSchema } from "../schemas/session.js";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { getLoginMethod } from "../profile/profile-loader.js";
import { getActiveProvider } from "../providers/active-provider-store.js";
import { assertNotSwitching } from "../providers/provider-switcher.js";
import { PlaceholderValidationError, resolveArgv } from "../profile/placeholder-resolver.js";
import { requireAction } from "../profile/require-action.js";
import { extractLoginUrl } from "../profile/response-parser.js";
import { executeVendorCommand, requestConnectionCheck } from "../proxy-client/proxy-client.js";
import { CommandExecutionError } from "../errors.js";
import { pickFailureOutput } from "../lib/failure-output.js";
import { redactSecrets } from "../lib/redact.js";
import { appendAuditLog } from "../audit-log/audit-log-store.js";
import { stripAnsi } from "../lib/strip-ansi.js";
import { clearConnectedLocation } from "../connection-state/connection-state-store.js";
import { clearLearnedRestrictions } from "../capabilities/restriction-learner.js";
import { getSessionInfo, invalidateSessionInfo } from "../session/session-probe.js";
import { assertValidSecrets, buildLoginStdin } from "../session/login-input.js";

/**
 * 目的: ログイン・ログアウトの成功後に、状態に依存するキャッシュ・学習を破棄する。

 * 入力: providerId(対象のベンダーID。ベンダーごとに別々に保持しているため)。
 * 副作用: ログイン状態・プランのキャッシュ、学習した制限を消す（プランが変わりうるため）。
 */
function resetSessionDerivedState(providerId: string): void {
  invalidateSessionInfo(providerId);
  clearLearnedRestrictions(providerId);
}

export const registerSessionRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/session",
    { schema: { response: { 200: SessionStateSchema } } },
    async () => {
      const provider = getActiveProvider();
      const info = await getSessionInfo(provider);
      return {
        loginMethod: getLoginMethod(provider.profile),
        ...(info.loggedIn === undefined ? {} : { loggedIn: info.loggedIn }),
        ...(info.plan === undefined ? {} : { plan: { id: info.plan.id, label: info.plan.label } }),
      };
    },
  );

  fastify.post(
    "/v1/session",
    {
      schema: {
        // ボディ無し（URL提示型）とnull（生成クライアントがボディ引数にnullを渡す場合）を許す。
        // Type.Optionalではボディ無しのリクエストが「body must be object」で400になるため、Nullとのユニオンにする。
        body: Type.Union([SessionLoginBodySchema, Type.Null()]),
        response: {
          200: SessionResponseSchema,
          400: ErrorResponseSchema,
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
      const { profile } = provider;
      const loginAction = requireAction(profile, "login");

      if (getLoginMethod(profile) === "credentials") {
        const credentials = request.body;
        if (!credentials) {
          throw new PlaceholderValidationError("username and password are required");
        }
        assertValidSecrets(credentials);
        const argv = resolveArgv(profile, "login", { USERNAME: credentials.username });
        const result = await executeVendorCommand(provider.id, {
          vendor: profile.vendor,
          binary: profile.binary,
          resolvedArgv: argv,
          timeoutMs: loginAction.timeoutMs,
          stdin: buildLoginStdin(credentials),
        });
        const exitCode = result.exitCode ?? -1;
        // 監査ログにはユーザー名のみ記録し、パスワード・2FAコードは残さない。
        appendAuditLog({ action: "login", provider: provider.id, input: { username: credentials.username }, exitCode });
        if (exitCode !== 0) {
          // CLIが入力を出力へ反映した場合の保険として、秘密を伏字にしてから応答へ入れる。
          const secrets = [credentials.password, credentials.twoFactorCode ?? ""];
          throw new CommandExecutionError(
            "login command failed",
            exitCode,
            redactSecrets(pickFailureOutput(result.stderr, result.stdout), secrets),
          );
        }
        resetSessionDerivedState(provider.id);
        return { message: "ログインしました。" };
      }

      const argv = resolveArgv(profile, "login", {});
      const result = await executeVendorCommand(provider.id, {
        vendor: profile.vendor,
        binary: profile.binary,
        resolvedArgv: argv,
        timeoutMs: loginAction.timeoutMs,
        completionPattern: loginAction.completionPattern,
      });
      // exitCode=nullは「completionPatternに一致し応答した時点ではプロセスが実行継続中」を表す。
      // 監査ログのexitCodeは実際の終了コードのみを記録する数値項目のため、その場合は記録しない
      // （後続の`status`呼び出しの監査ログで実際の結果が記録される）。
      appendAuditLog({ action: "login", provider: provider.id, exitCode: result.exitCode ?? undefined });
      if (result.exitCode === null) {
        // completionPattern（ログインURLの出力パターン）に一致した時点。CLIプロセスはプロキシ側で認証待ちを継続する。
        return {
          loginUrl: extractLoginUrl(result.stdout),
          message: "表示されたURLをブラウザで開いてログインを完了してください。",
        };
      }
      if (result.exitCode !== 0) {
        throw new CommandExecutionError(
          "login command failed",
          result.exitCode,
          pickFailureOutput(result.stderr, result.stdout),
        );
      }
      // completionPatternに一致せずプロセスが正常終了した場合（既にログイン済み等）。
      resetSessionDerivedState(provider.id);
      const message = stripAnsi(result.stdout).trim();
      return { message: message.length > 0 ? message : "既にログインしています。" };
    },
  );

  fastify.delete(
    "/v1/session",
    {
      schema: {
        response: {
          200: SessionResponseSchema,
          422: ErrorResponseSchema,
          501: ErrorResponseSchema,
          502: ErrorResponseSchema,
          504: ErrorResponseSchema,
        },
      },
    },
    async () => {
      assertNotSwitching();
      const provider = getActiveProvider();
      const { profile } = provider;
      const logoutAction = requireAction(profile, "logout");
      const result = await executeVendorCommand(provider.id, {
        vendor: profile.vendor,
        binary: profile.binary,
        resolvedArgv: resolveArgv(profile, "logout", {}),
        timeoutMs: logoutAction.timeoutMs,
      });
      const exitCode = result.exitCode ?? -1;
      appendAuditLog({ action: "logout", provider: provider.id, exitCode });
      // ログアウトでVPNも終了しうる（Proton VPN CLIのsignout）ため、ゲートウェイルールの再構成を依頼する。
      await requestConnectionCheck();
      if (exitCode !== 0) {
        throw new CommandExecutionError("logout command failed", exitCode, pickFailureOutput(result.stderr, result.stdout));
      }
      // ログアウトで接続も終了する（Proton VPN CLIの`signout`）ため、保存した接続先も消す。
      clearConnectedLocation(provider.id);
      resetSessionDerivedState(provider.id);
      const message = stripAnsi(result.stdout).trim();
      return { message: message.length > 0 ? message : "ログアウトしました。" };
    },
  );
};
