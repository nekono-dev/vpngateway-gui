// 責務: ベンダーCLIの`list-locations`を（プロキシ経由で）実行し、接続先の配列として返す。
// `GET /v1/connection/locations`と、接続時の接続先ID解決（`PUT /v1/connection`）の両方が使う。
// キャッシュはしない（ping値の鮮度は利用者の「再計測」操作で決める。apiserver/design.md参照）。

import { loadVendorProfile } from "../profile/profile-loader.js";
import { resolveArgv } from "../profile/placeholder-resolver.js";
import { executeVendorCommand } from "../proxy-client/proxy-client.js";
import { CommandExecutionError } from "../errors.js";
import { pickFailureOutput } from "../lib/failure-output.js";
import { parseLocationList, type ParsedLocation } from "./location-list-parser.js";

/**
 * 目的: `listLocations`アクションを実行し、接続先をping昇順で取得する。
 * 出力: 接続先の配列（`connectName`を含む。APIレスポンスへは含めない内部値）。
 * 失敗時の方針: コマンドの非ゼロ終了（未ログイン等）はCommandExecutionError（422）、
 *              プロキシ未応答・タイムアウトはproxy-clientの例外（502/504）、
 *              出力が想定外の書式なら通常のError（500）を、いずれもそのまま呼び出し元へ伝える。
 * 副作用: プロキシ上でベンダーCLIを1回実行する（約1秒）。
 */
export async function fetchLocations(): Promise<ParsedLocation[]> {
  const profile = loadVendorProfile();
  const result = await executeVendorCommand({
    vendor: profile.vendor,
    binary: profile.binary,
    resolvedArgv: resolveArgv(profile, "listLocations", {}),
    timeoutMs: profile.actions.listLocations.timeoutMs,
  });
  // completionPatternを指定しないため、exitCodeがnull（実行継続中）になることはない。念のため-1へ正規化する。
  const exitCode = result.exitCode ?? -1;
  if (exitCode !== 0) {
    throw new CommandExecutionError(
      "list-locations command failed",
      exitCode,
      pickFailureOutput(result.stderr, result.stdout),
    );
  }
  return parseLocationList(result.stdout);
}
