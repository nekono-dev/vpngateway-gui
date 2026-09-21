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
import { requireAction } from "../profile/require-action.js";
import { parseConnectionOutput } from "../profile/response-parser.js";
import { executeVendorCommand } from "../proxy-client/proxy-client.js";
import { CommandExecutionError } from "../errors.js";
import { throwCommandFailure } from "../capabilities/restriction-learner.js";
import type { OperationKey } from "../capabilities/operations.js";
import { pickFailureOutput } from "../lib/failure-output.js";
import { appendAuditLog } from "../audit-log/audit-log-store.js";
import {
  clearConnectedLocation,
  reconcileLocation,
  saveConnectedLocation,
} from "../connection-state/connection-state-store.js";
import { fetchLocations } from "../locations/location-fetcher.js";
import { saveLastLocationId } from "../locations/last-location-store.js";
import type { ParsedLocation } from "../locations/location-list-parser.js";

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
        throw new CommandExecutionError(
          "status command failed",
          exitCode,
          pickFailureOutput(result.stderr, result.stdout),
        );
      }
      return reconcileLocation(parseConnectionOutput(profile.outputFormat, result.stdout, profile.output));
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
      const profile = loadVendorProfile();
      const body = request.body;

      // 監査ログ・タイムアウトの単位は接続系を"connect"にまとめる（接続先の指定有無は`input`で分かる）。
      const actionName = body.connect ? "connect" : "disconnect";
      // 接続先はクライアントから都市名を直接受け取らず、IDを直前の`list-locations`の結果と照合して
      // 接続時の指定名へ解決する（任意の文字列がCLIへ渡らないようにするため。サーバ増減にも追従する）。
      // locationIdが無い接続は、`connectAuto`（プロバイダが接続先を選ぶ。無料版のProton VPN等）を使う。
      let target: ParsedLocation | undefined;
      let argv: string[];
      // 実行失敗時にプラン制限（403）かを判定するための、実際に実行するアクションとオペレーション。
      let executed: { action: { timeoutMs: number; restrictedPattern?: string }; operation: OperationKey | undefined };
      if (body.connect && body.locationId) {
        const connectAction = requireAction(profile, "connect");
        const locations = await fetchLocations();
        target = locations.find((location) => location.id === body.locationId);
        if (!target) {
          throw new PlaceholderValidationError(`unknown locationId: ${body.locationId}`);
        }
        argv = resolveArgv(
          profile,
          "connect",
          { LOCATION: target.connectName },
          { LOCATION: locations.map((location) => location.connectName) },
        );
        executed = { action: connectAction, operation: "connectToLocation" };
      } else if (body.connect) {
        if (profile.actions.connectAuto === undefined) {
          throw new PlaceholderValidationError("locationId is required when connect=true");
        }
        argv = resolveArgv(profile, "connectAuto", {});
        executed = { action: profile.actions.connectAuto, operation: "connectAuto" };
      } else {
        argv = resolveArgv(profile, "disconnect", {});
        executed = { action: profile.actions.disconnect, operation: undefined };
      }

      const result = await executeVendorCommand({
        vendor: profile.vendor,
        binary: profile.binary,
        resolvedArgv: argv,
        timeoutMs: executed.action.timeoutMs,
      });

      // connect/disconnectはcompletionPatternを指定しないため、exitCodeがnull（プロセス実行継続中）
      // になることはない。念のため-1（既存のタイムアウト表現）へ正規化する。
      const exitCode = result.exitCode ?? -1;
      appendAuditLog({ action: actionName, input: body, exitCode });

      if (exitCode !== 0) {
        const output = pickFailureOutput(result.stderr, result.stdout);
        if (executed.operation === undefined) {
          throw new CommandExecutionError(`${actionName} command failed`, exitCode, output);
        }
        // プラン制限による失敗（restrictedPattern一致）は403で通知し、そのオペレーションを制限として学習する。
        throwCommandFailure(`${actionName} command failed`, exitCode, output, {
          pattern: executed.action.restrictedPattern,
          operation: executed.operation,
        });
      }
      const status = parseConnectionOutput(profile.outputFormat, result.stdout, profile.output);
      // 接続国・接続先IDはCLI出力から取れないため、成功した接続操作で要求した接続先を保存し（切断なら消去）、
      // GET /v1/connection・リロード後の表示でも返せるようにする。あわせて「最後に接続した接続先」を記憶する
      // （こちらは切断しても消さない。次回の既定選択に使う）。
      if (target && status.status === "connected") {
        saveConnectedLocation({ locationId: target.id, country: target.country }, status.location);
        saveLastLocationId(target.id);
        return { ...status, country: target.country, locationId: target.id };
      }
      clearConnectedLocation();
      return status;
    },
  );
};
