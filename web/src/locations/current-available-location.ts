// 責務: 「プランで接続できる接続先の参考一覧」の中から、現在接続中の国を特定する純粋関数のみを行う。
// 参考一覧（AvailableLocation）は接続先を選べないプランのため接続先IDを持たず、CLIが報告する接続先の
// 表記（ConnectionState.location）の中に、一覧の各国が持つ都市名（cities）のいずれかが現れるかで突き合わせる
// （webserver/requirements.md「参考一覧での現在の接続先の表示」、locations/current-location.tsの
// findCurrentLocationIdと同じ考え方を参考一覧向けに行う）。
// 【実機確認（2026-09-22）】自動接続時、CLIは都市名のみではなく「サーバ名 in 都市名, 国名」のような
// 複合表記（例: "US-FREE#5 in Seattle, United States"）を報告することがある。都市名の完全一致ではなく、
// 部分一致（複合表記の中に都市名が含まれるか）で判定する。

import type { ConnectionState } from "../hooks/useDashboardPolling";
import type { AvailableLocation } from "../hooks/useAvailableLocations";

export interface CurrentAvailableLocation {
  code: string;
  // 一覧のcitiesの表記に揃えた都市名（CLIの複合表記から一致した部分を抜き出したもの）。
  city: string;
}

/**
 * 目的: 参考一覧の中から、現在接続中の国（と都市名）を特定する。
 * 入力: connection(`GET /v1/connection`の応答。未取得ならundefined), locations(参考一覧)。
 * 出力: 接続中で、報告された接続先の表記にいずれかの国のcitiesのいずれかが含まれれば、その国のcodeと
 *       一致した都市名（一覧の表記）。未接続・表記が無い・一致する都市が無ければundefined。
 * 例: findCurrentAvailableLocation(
 *       { status: "connected", location: "US-FREE#5 in Seattle, United States" },
 *       [{ code: "us", name: "アメリカ合衆国", cities: ["Seattle", "Chicago"] }],
 *     ) // => { code: "us", city: "Seattle" }
 */
export function findCurrentAvailableLocation(
  connection: ConnectionState | undefined,
  locations: AvailableLocation[],
): CurrentAvailableLocation | undefined {
  if (connection?.status !== "connected" || !connection.location) return undefined;
  const reported = connection.location.toLowerCase();
  for (const location of locations) {
    const matchedCity = location.cities.find((city) => reported.includes(city.toLowerCase()));
    if (matchedCity) return { code: location.code, city: matchedCity };
  }
  return undefined;
}
