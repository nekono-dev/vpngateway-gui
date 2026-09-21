// 責務: 接続先リストの表示対象（タブ・検索語）の絞り込みのみを行う純粋関数。
// 並び順（ping昇順）はAPIが決めて返すため、ここでは並べ替えず入力順をそのまま保つ
// （webserver/design.md「接続先リストの実装方針（Phase 8）」）。

import type { GetV1ConnectionLocations200Item } from "../generated/api/endpoints.schemas";

export type LocationItem = GetV1ConnectionLocations200Item;
export type LocationTab = "all" | "favorites";

/**
 * 目的: 接続先の表示名を返す。都市を持たない接続先（Proton VPNの国単位の一覧）は国名にする。
 * 入力: location(APIが返した接続先)。
 * 出力: 都市名、無ければ国名。
 * 例: locationLabel({ city: "Tokyo", countryName: "Japan", ... }) // => "Tokyo"
 *     locationLabel({ countryName: "Japan", ... }) // => "Japan"
 */
export function locationLabel(location: LocationItem): string {
  return location.city ?? location.countryName;
}

/**
 * 目的: タブと検索語で接続先を絞り込む。
 * 入力: locations(APIが返したping昇順の接続先), tab("all"=全件, "favorites"=お気に入りのみ),
 *       query(検索語。前後の空白は無視し、空白区切りの各語がすべて、国コード・国名・都市名のいずれかに
 *       含まれる接続先だけを残す。大文字小文字は区別しない)。
 * 出力: 条件に合う接続先。入力の順序を保つ。
 * 例: filterLocations(locations, "all", "us vegas") // => [Las Vegas (US)]
 */
export function filterLocations(locations: LocationItem[], tab: LocationTab, query: string): LocationItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 0);
  return locations.filter((location) => {
    if (tab === "favorites" && !location.favorite) return false;
    const haystack = `${location.country} ${location.countryName} ${location.city ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
