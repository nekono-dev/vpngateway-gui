// 責務: CLIの接続先一覧アクション（`listLocations`）を（ランナー経由で）実行し、接続先の配列として返す。
// `GET /v1/connection/locations`と、接続時の接続先ID解決（`PUT /v1/connection`）の両方が使う。
// キャッシュはしない（ping値の鮮度は利用者の「再計測」操作で決める。apiserver/design.md参照）。

import type { Provider } from "../providers/provider-registry.js";
import { resolveArgv } from "../profile/placeholder-resolver.js";
import { requireAction } from "../profile/require-action.js";
import { executeVendorCommand } from "../proxy-client/proxy-client.js";
import { throwCommandFailure } from "../capabilities/restriction-learner.js";
import { pickFailureOutput } from "../lib/failure-output.js";
import { parseLocationList, type ParsedLocation } from "./location-list-parser.js";

/**
 * 目的: `listLocations`アクションを実行し、接続先をping昇順で取得する。
 * 出力: 接続先の配列（`connectName`を含む。APIレスポンスへは含めない内部値）。
 * 失敗時の方針: `listLocations`未定義（プロバイダ非対応）はOperationUnsupportedError（501）、
 *              コマンドの非ゼロ終了はプラン制限（`restrictedPattern`一致）ならOperationRestrictedError（403）、
 *              それ以外（未ログイン等）はCommandExecutionError（422）、
 *              プロキシ未応答・タイムアウトはproxy-clientの例外（502/504）、
 *              出力が想定外の書式なら通常のError（500）を、いずれもそのまま呼び出し元へ伝える。
 * 入力: provider(対象のベンダー)。
 * 副作用: そのベンダーのランナー上でCLIを1回実行する（約1秒）。
 */
export async function fetchLocations(provider: Provider): Promise<ParsedLocation[]> {
  const { profile } = provider;
  const action = requireAction(profile, "listLocations");
  const result = await executeVendorCommand(provider.id, {
    vendor: profile.vendor,
    binary: profile.binary,
    resolvedArgv: resolveArgv(profile, "listLocations", {}),
    timeoutMs: action.timeoutMs,
  });
  // completionPatternを指定しないため、exitCodeがnull（実行継続中）になることはない。念のため-1へ正規化する。
  const exitCode = result.exitCode ?? -1;
  if (exitCode !== 0) {
    throwCommandFailure(
      provider.id,
      "list-locations command failed",
      exitCode,
      pickFailureOutput(result.stderr, result.stdout),
      { pattern: action.restrictedPattern, operation: "locationList" },
    );
  }
  return parseLocationList(result.stdout, { table: action.table, connectName: action.connectName });
}
