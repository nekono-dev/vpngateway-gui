// 責務: 接続先（ロケーション）の安定ID・接続時の指定名を、ベンダーCLIの表示名から導出する。
// IDはお気に入り・最後の接続先の永続化キーとURLパスに使う（apiserver/design.md「接続先の識別と接続時の指定名」）。

import { slugify } from "../lib/slugify.js";

// IDの形式。URLパスへそのまま置け、永続化ファイルの破損時にも検証できるよう文字種を絞る。
export const LOCATION_ID_PATTERN = "^[a-z]{2}-[a-z0-9-]{1,64}$";

// 実CLIの`list-locations`は一部の都市名に" (Virtual)"を付けて表示するが、`connect -l`はその表示名では
// 接続できず、付けない名前でのみ接続できる（実機確認: `Shanghai (Virtual)`は失敗、`Shanghai`は成功）。
const VIRTUAL_SUFFIX_PATTERN = /\s*\(Virtual\)\s*$/;

/**
 * 目的: 接続先の安定IDを導出する。
 * 入力: isoCode(ISO国コード。大文字小文字は問わない), city(`list-locations`が表示する都市名)。
 * 出力: `<国コード小文字>-<都市名のslug>`形式のID。
 * 例: toLocationId("US", "Las Vegas") // => "us-las-vegas"
 *     toLocationId("CN", "Shanghai (Virtual)") // => "cn-shanghai-virtual"
 */
export function toLocationId(isoCode: string, city: string): string {
  return `${isoCode.toLowerCase()}-${slugify(city, "location")}`;
}

/**
 * 目的: `connect -l`へ渡す接続時の指定名を、表示の都市名から導出する。
 * 入力: city(`list-locations`が表示する都市名)。
 * 出力: 末尾の" (Virtual)"を除いた都市名。
 * 例: toConnectName("Shanghai (Virtual)") // => "Shanghai"
 *     toConnectName("Tokyo") // => "Tokyo"
 */
export function toConnectName(city: string): string {
  return city.replace(VIRTUAL_SUFFIX_PATTERN, "");
}
