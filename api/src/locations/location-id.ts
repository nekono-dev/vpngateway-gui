// 責務: 接続先（ロケーション）の安定ID・接続時の指定名を、CLIの表示名から導出する。
// IDはお気に入り・最後の接続先の永続化キーとURLパスに使う（apiserver/design.md「接続先の識別と接続時の指定名」）。

import { slugify } from "../lib/slugify.js";

// IDの形式。URLパスへそのまま置け、永続化ファイルの破損時にも検証できるよう文字種を絞る。
export const LOCATION_ID_PATTERN = "^[a-z]{2}-[a-z0-9-]{1,64}$";

/**
 * 目的: 接続先の安定IDを導出する。
 * 入力: isoCode(ISO国コード。大文字小文字は問わない), city(一覧が表示する都市名)。
 * 出力: `<国コード小文字>-<都市名のslug>`形式のID。
 * 例: toLocationId("US", "Las Vegas") // => "us-las-vegas"
 *     toLocationId("DE", "Frankfurt (Annex)") // => "de-frankfurt-annex"
 */
export function toLocationId(isoCode: string, city: string): string {
  return `${isoCode.toLowerCase()}-${slugify(city, "location")}`;
}

/**
 * 目的: 接続コマンドへ渡す接続時の指定名を、表示の都市名から導出する。
 * 入力: city(一覧が表示する都市名), stripPattern(省略可。指定名から取り除く部分の正規表現ソース。プロファイルの`connectName.stripPattern`)。
 * 出力: `stripPattern`に最初に一致した部分を取り除いた都市名。`stripPattern`が無ければ都市名のまま。
 * 例: toConnectName("Springfield (Annex)", "\\s*\\(Annex\\)\\s*$") // => "Springfield"
 *     toConnectName("Tokyo") // => "Tokyo"
 */
export function toConnectName(city: string, stripPattern?: string): string {
  return stripPattern === undefined ? city : city.replace(new RegExp(stripPattern), "");
}
