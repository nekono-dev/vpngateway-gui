// 責務: apiコンテナ起動時、直前のプロセス終了時点で接続中だった接続先へ自動的に再接続する（状態の復元）。
// VPN接続中に意図せずホスト・コンテナが再起動された場合でも、再起動後に元の接続状態へ戻すことを目的とする
// （specs/requirements.md「起動時の接続状態の復元」、apiserver/design.md「起動時の接続復元」）。
// server.tsの`pushCurrentSettingsToProxy`と同方針（起動を妨げない・失敗はログのみ）。

import { getActiveProvider } from "../providers/active-provider-store.js";
import { getStoredConnection } from "./connection-state-store.js";
import { applyConnectionChange } from "./apply-connection.js";
import { resolveArgv } from "../profile/placeholder-resolver.js";
import { parseConnectionOutput } from "../profile/response-parser.js";
import { executeVendorCommand, checkRunnerHealth } from "../proxy-client/proxy-client.js";

interface Logger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

// ランナーコンテナはapiの`depends_on`に含まれない（docker-compose.yml参照）ため、api起動直後は
// まだ応答しないことがある。数回リトライして待つ（pushCurrentSettingsToProxyと同じ間隔）。
const RUNNER_WAIT_RETRY_DELAYS_MS = [500, 1000, 2000, 3000];

/**
 * 目的: ランナーが応答するようになるまで数回待つ。
 * 入力: providerId(対象のベンダーID)。
 * 出力: 応答すればtrue、リトライし尽くしても応答しなければfalse。
 */
async function waitForRunner(providerId: string): Promise<boolean> {
  if (await checkRunnerHealth(providerId)) return true;
  for (const delayMs of RUNNER_WAIT_RETRY_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (await checkRunnerHealth(providerId)) return true;
  }
  return false;
}

/**
 * 目的: 起動時、選択中のベンダーについて「直前に接続中だった接続先」への再接続を試みる。
 * 入力: logger(結果の記録先。fastifyのlogger等)。
 * 出力: なし。
 * 失敗時の方針: 保存済みの接続情報が無い（直前が切断中だった、または一度も接続していない）場合は何もしない。
 *              ランナー未起動・ステータス確認失敗・再接続の失敗は、起動を妨げずログに警告として記録するのみ
 *              （未ログイン等で再接続できない場合も同様。利用者が手動で接続し直せる）。
 * 副作用: 対象ベンダーのランナー上でCLIを実行しうる（`status`・接続コマンド）。
 */
export async function restoreConnectionOnStartup(logger: Logger): Promise<void> {
  const provider = getActiveProvider();
  const stored = getStoredConnection(provider.id);
  if (!stored) return;

  if (!(await waitForRunner(provider.id))) {
    logger.warn({ provider: provider.id }, "runner not ready; skipped startup connection restore");
    return;
  }

  const { profile } = provider;
  try {
    const statusResult = await executeVendorCommand(provider.id, {
      vendor: profile.vendor,
      binary: profile.binary,
      resolvedArgv: resolveArgv(profile, "status", {}),
      timeoutMs: profile.actions.status.timeoutMs,
    });
    if ((statusResult.exitCode ?? -1) === 0) {
      const status = parseConnectionOutput(profile.outputFormat, statusResult.stdout, profile.output);
      if (status.status === "connected") {
        // 既に接続中（apiコンテナ単体の再起動等、トンネル自体は生きていた場合）。再接続は不要。
        logger.info({ provider: provider.id }, "already connected at startup; skipped connection restore");
        return;
      }
    }
  } catch (error) {
    logger.warn({ provider: provider.id, error }, "failed to check status before startup connection restore; will still try to reconnect");
  }

  try {
    const body = stored.locationId ? { connect: true as const, locationId: stored.locationId } : { connect: true as const };
    await applyConnectionChange(provider, body);
    logger.info({ provider: provider.id, locationId: stored.locationId, country: stored.country }, "restored VPN connection at startup");
  } catch (error) {
    logger.warn({ provider: provider.id, error }, "failed to restore VPN connection at startup");
  }
}
