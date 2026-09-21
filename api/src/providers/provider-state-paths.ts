// 責務: ベンダー別の永続化ファイル（接続状態・最後の接続先・お気に入り）のパス導出と、Phase 10以前の旧形式からの移行。
// ベンダーごとに`$STATE_DIR/providers/<ベンダーID>/`以下へ保存し、ベンダーを切り替えても互いの状態を失わない
// （apiserver/design.md「ベンダーの選択」）。ユーザ向け設定（settings.json）・監査ログはベンダーに依存しないため対象外。

import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 目的: 永続化の基点ディレクトリを返す。
 * 出力: 環境変数`STATE_DIR`（既定/var/lib/vpngwgui）。呼び出しごとに読む（テストで切り替えるため）。
 */
export function stateDir(): string {
  return process.env.STATE_DIR ?? "/var/lib/vpngwgui";
}

/**
 * 目的: ベンダー別の状態ファイルのパスを返す。
 * 入力: providerId(検証済みのベンダーID), fileName(ファイル名。例 "connection-state.json")。
 * 出力: `$STATE_DIR/providers/<providerId>/<fileName>`。
 * 例: providerStatePath("adguardvpn", "last-location.json") // => "/var/lib/vpngwgui/providers/adguardvpn/last-location.json"
 */
export function providerStatePath(providerId: string, fileName: string): string {
  return join(stateDir(), "providers", providerId, fileName);
}

// Phase 10以前は全て単一のベンダー（AdGuard VPN）の状態として、$STATE_DIR直下に保存されていた。
const LEGACY_FILES = ["connection-state.json", "last-location.json", "favorite-locations.json"] as const;

/**
 * 目的: 旧形式（`$STATE_DIR`直下）の状態ファイルを、`providers/adguardvpn/`へ移す（Phase 10以前の状態は全てAdGuard VPNのものであるため）。
 * 入力: enabledIds(有効なベンダーIDの配列)。
 * 出力: 移したファイル名の配列。
 * 副作用: `adguardvpn`が有効で、旧ファイルがあり、移動先に同名のファイルが無い場合のみ、ファイルを移動する（rename）。
 *        `adguardvpn`が有効でなければ何もしない（別ベンダーの状態として誤って引き継がないため）。冪等。
 * 例: migrateLegacyState(["adguardvpn"]) // => ["favorite-locations.json"]
 */
export function migrateLegacyState(enabledIds: readonly string[]): string[] {
  if (!enabledIds.includes("adguardvpn")) return [];
  const moved: string[] = [];
  for (const fileName of LEGACY_FILES) {
    const from = join(stateDir(), fileName);
    const to = providerStatePath("adguardvpn", fileName);
    if (existsSync(from) && !existsSync(to)) {
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
      moved.push(fileName);
    }
  }
  return moved;
}
