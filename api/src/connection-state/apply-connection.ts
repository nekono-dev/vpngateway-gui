// 責務: 接続/切断の実行そのもの（接続先の解決・CLI実行・成否判定・永続化）を行う。
// `PUT /v1/connection`ルートと、起動時の接続復元（restore-connection.ts、Phase 16）の両方から呼ばれるため、
// 元々ルートハンドラに書かれていたこの処理を切り出した（apiserver/design.md「接続の実行（切り出し）」）。

import { isCommandSuccess } from "../profile/command-success.js";
import { resolveArgv, PlaceholderValidationError } from "../profile/placeholder-resolver.js";
import { requireAction } from "../profile/require-action.js";
import { parseConnectionOutput } from "../profile/response-parser.js";
import { executeVendorCommand, requestConnectionCheck } from "../proxy-client/proxy-client.js";
import { CommandExecutionError } from "../errors.js";
import { throwCommandFailure } from "../capabilities/restriction-learner.js";
import type { OperationKey } from "../capabilities/operations.js";
import { pickFailureOutput } from "../lib/failure-output.js";
import { appendAuditLog } from "../audit-log/audit-log-store.js";
import { clearConnectedLocation, saveConnectedLocation } from "./connection-state-store.js";
import { fetchLocations } from "../locations/location-fetcher.js";
import { saveLastLocationId } from "../locations/last-location-store.js";
import type { ParsedLocation } from "../locations/location-list-parser.js";
import type { Provider } from "../providers/provider-registry.js";
import type { ConnectionPutBody, ConnectionStatus } from "../schemas/connection.js";

/**
 * 目的: 接続先の指定有無に応じてコマンドを解決し、実行し、結果を永続化する。
 * 入力: provider(対象のベンダー), body(`connect`=trueなら接続/変更、falseなら切断。`locationId`任意)。
 * 出力: 実行後の接続状態（接続なら`country`・`locationId`を含む）。
 * 失敗時の方針: 呼び出し元（ルートハンドラ）と同じ例外をそのまま投げる（PlaceholderValidationError・
 *              OperationUnsupportedError・CommandExecutionError・OperationRestrictedError等）。
 *              呼び出し側で`assertNotSwitching()`等の前提を確認済みであることを要求する（ここでは確認しない）。
 * 副作用: そのベンダーのランナー上でCLIを1回実行し、監査ログに記録し、ネットワークコンテナへ再確認を依頼する
 *        （失敗しても無視）。成功時は接続先・「最後に接続した接続先」を永続化し（切断・失敗時は接続先を消去）する。
 */
export async function applyConnectionChange(provider: Provider, body: ConnectionPutBody): Promise<ConnectionStatus> {
  const { profile } = provider;
  const actionName = body.connect ? "connect" : "disconnect";
  let target: ParsedLocation | undefined;
  let argv: string[];
  let executed: { action: { timeoutMs: number; restrictedPattern?: string; successPattern?: string }; operation: OperationKey | undefined };
  if (body.connect && body.locationId) {
    const connectAction = requireAction(profile, "connect");
    const locations = await fetchLocations(provider);
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

  const result = await executeVendorCommand(provider.id, {
    vendor: profile.vendor,
    binary: profile.binary,
    resolvedArgv: argv,
    timeoutMs: executed.action.timeoutMs,
  });

  const exitCode = result.exitCode ?? -1;
  appendAuditLog({ action: actionName, provider: provider.id, input: body, exitCode });
  await requestConnectionCheck();

  if (!isCommandSuccess(executed.action, result)) {
    const output = pickFailureOutput(result.stderr, result.stdout);
    if (executed.operation === undefined) {
      throw new CommandExecutionError(`${actionName} command failed`, exitCode, output);
    }
    throwCommandFailure(provider.id, `${actionName} command failed`, exitCode, output, {
      pattern: executed.action.restrictedPattern,
      operation: executed.operation,
    });
  }
  const status = parseConnectionOutput(profile.outputFormat, result.stdout, profile.output);
  if (status.status === "connected") {
    // 接続先を指定した接続に加え、自動接続（target無し。接続先を選べないプラン等）でも空の内容で保存する
    // （Phase 16: 「接続中であったこと自体」が起動時の接続復元の手がかりになるため）。
    saveConnectedLocation(provider.id, target ? { locationId: target.id, country: target.country } : {}, status.location);
    if (target) {
      saveLastLocationId(provider.id, target.id);
      return { ...status, country: target.country, locationId: target.id };
    }
    return status;
  }
  clearConnectedLocation(provider.id);
  return status;
}
