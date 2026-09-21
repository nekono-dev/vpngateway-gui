// 責務: ベンダー別の永続化ファイル（接続状態・最後の接続先・お気に入り）のパス導出。
// ベンダーごとに`$STATE_DIR/providers/<ベンダーID>/`以下へ保存し、ベンダーを切り替えても互いの状態を失わない
// （apiserver/design.md「ベンダーの選択」）。ユーザ向け設定（settings.json）・監査ログはベンダーに依存しないため対象外。

import { join } from "node:path";

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
 * 例: providerStatePath("vendora", "last-location.json") // => "/var/lib/vpngwgui/providers/vendora/last-location.json"
 */
export function providerStatePath(providerId: string, fileName: string): string {
  return join(stateDir(), "providers", providerId, fileName);
}
