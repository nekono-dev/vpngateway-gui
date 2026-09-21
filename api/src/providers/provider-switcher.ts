// 責務: 使うベンダーの切替の手順（apiserver/design.md「切替の手順」）。接続中なら現在のベンダーを切断してから
// 選択中のベンダーを更新し、監査ログに残し、ネットワークコンテナへ接続状態の再確認を依頼する。
// 切替中は、ベンダーに対する他の操作（接続・ログイン等）を409で拒否する（切替前後のどちらのベンダーへ作用するか曖昧に
// なるのを避けるため。プロセス内の単純な排他で、API複数台構成は想定しない）。

import { isCommandSuccess } from "../profile/command-success.js";
import { appendAuditLog } from "../audit-log/audit-log-store.js";
import { clearConnectedLocation } from "../connection-state/connection-state-store.js";
import { CommandExecutionError, ProviderSwitchingError, ProxyTimeoutError, ProxyUnavailableError } from "../errors.js";
import { pickFailureOutput } from "../lib/failure-output.js";
import { PlaceholderValidationError, resolveArgv } from "../profile/placeholder-resolver.js";
import { parseConnectionOutput } from "../profile/response-parser.js";
import { executeVendorCommand, checkRunnerHealth, requestConnectionCheck } from "../proxy-client/proxy-client.js";
import { getActiveProvider, saveActiveProviderId } from "./active-provider-store.js";
import { findProvider, type Provider } from "./provider-registry.js";

let switching = false;

/**
 * 目的: ベンダーの切替中でないことを確認する。ベンダーに対する変更系の操作（接続・切断・ログイン・ログアウト）の先頭で呼ぶ。
 * 入力: なし。
 * 出力: なし。
 * 失敗時の方針: 切替中ならProviderSwitchingError（HTTP 409）を投げる。
 */
export function assertNotSwitching(): void {
  if (switching) {
    throw new ProviderSwitchingError("the VPN provider is being switched; retry after it completes");
  }
}

/**
 * 目的: 現在のベンダーがVPNに接続中なら切断する。
 * 入力: current(現在のベンダー)。
 * 出力: なし。
 * 失敗時の方針:
 *   - 現在のランナーが応答しない（ProxyUnavailableError/ProxyTimeoutError）場合は、切断できないが何もせず戻る
 *     （止まったランナーに縛られて他のベンダーへ切り替えられなくならないため）。
 *   - `status`が非ゼロ終了（未ログイン等）の場合は、接続していないとみなして何もしない。
 *   - 接続中と判定され`disconnect`が非ゼロ終了ならCommandExecutionError（422）を投げ、切替を中止させる
 *     （VPNが繋がったまま別のベンダーを選ぶ状態を作らないため）。
 * 副作用: 現在のベンダーのランナー上でCLIを実行する。切断に成功したら保存済みの接続先を消す。
 */
async function disconnectIfConnected(current: Provider): Promise<void> {
  const { profile } = current;
  let connected: boolean;
  try {
    const status = await executeVendorCommand(current.id, {
      vendor: profile.vendor,
      binary: profile.binary,
      resolvedArgv: resolveArgv(profile, "status", {}),
      timeoutMs: profile.actions.status.timeoutMs,
    });
    if ((status.exitCode ?? -1) !== 0) return;
    connected = parseConnectionOutput(profile.outputFormat, status.stdout, profile.output).status === "connected";
  } catch (error) {
    if (error instanceof ProxyUnavailableError || error instanceof ProxyTimeoutError) return;
    throw error;
  }
  if (!connected) return;

  const result = await executeVendorCommand(current.id, {
    vendor: profile.vendor,
    binary: profile.binary,
    resolvedArgv: resolveArgv(profile, "disconnect", {}),
    timeoutMs: profile.actions.disconnect.timeoutMs,
  });
  const exitCode = result.exitCode ?? -1;
  appendAuditLog({ action: "disconnect", provider: current.id, input: { reason: "switch-provider" }, exitCode });
  if (!isCommandSuccess(profile.actions.disconnect, result)) {
    throw new CommandExecutionError("disconnect command failed", exitCode, pickFailureOutput(result.stderr, result.stdout));
  }
  clearConnectedLocation(current.id);
}

/**
 * 目的: 使うベンダーを切り替える。
 * 入力: providerId(切替先のベンダーID)。
 * 出力: 切替後に選択中となったProvider。選択中と同じIDなら何もせずそのProvider。
 * 失敗時の方針: 無効・未知のIDはPlaceholderValidationError（400）。切替先のランナーが利用不可ならProxyUnavailableError（502）。
 *              切替中の重複した切替はProviderSwitchingError（409）。現在のVPNの切断失敗はCommandExecutionError（422）で、
 *              その場合は選択を変えない。
 * 副作用: 選択の永続化、監査ログ（switch-provider）、ネットワークコンテナへの`POST /connection-checks`（失敗は無視）。
 * 例: await switchProvider("vendorb")
 */
export async function switchProvider(providerId: string): Promise<Provider> {
  const target = findProvider(providerId);
  if (!target) {
    throw new PlaceholderValidationError(`unknown or disabled provider: ${providerId}`);
  }
  assertNotSwitching();
  const current = getActiveProvider();
  if (current.id === target.id) return target;
  if (!(await checkRunnerHealth(target.id))) {
    throw new ProxyUnavailableError(`the runner for "${target.id}" is not available`);
  }

  switching = true;
  try {
    await disconnectIfConnected(current);
    saveActiveProviderId(target.id);
    appendAuditLog({ action: "switch-provider", provider: target.id, input: { from: current.id, to: target.id }, exitCode: 0 });
  } finally {
    switching = false;
  }
  // ルールの反映は接続監視ループもいずれ追従するため、失敗しても切替は成功とする。
  await requestConnectionCheck();
  return target;
}
