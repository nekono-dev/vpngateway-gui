// 責務: 「プランで接続できる接続先の参考一覧」の中から、現在接続中の国を特定する純粋関数のみを行う。
// 参考一覧（AvailableLocation）は接続先を選べないプランのため接続先IDを持たず、CLIが報告する都市名
// （ConnectionState.location）を、一覧の各国が持つ都市名（cities）と突き合わせて特定する
// （webserver/requirements.md「参考一覧での現在の接続先の表示」、locations/current-location.tsの
// findCurrentLocationIdと同じ考え方を参考一覧向けに行う）。

import type { ConnectionState } from "../hooks/useDashboardPolling";
import type { AvailableLocation } from "../hooks/useAvailableLocations";

export interface CurrentAvailableLocation {
  code: string;
  // CLIが報告した都市名（そのまま。一覧のcitiesの表記と大文字小文字が異なっていてもよい）。
  city: string;
}

/**
 * 目的: 参考一覧の中から、現在接続中の国（と都市名）を特定する。
 * 入力: connection(`GET /v1/connection`の応答。未取得ならundefined), locations(参考一覧)。
 * 出力: 接続中で、報告された都市名がいずれかの国のcitiesに一致すればその国のcodeと都市名。
 *       未接続・都市名が無い・一致する国が無ければundefined。
 * 例: findCurrentAvailableLocation({ status: "connected", location: "Tokyo" }, [{ code: "jp", name: "日本", cities: ["Tokyo"] }])
 *     // => { code: "jp", city: "Tokyo" }
 */
export function findCurrentAvailableLocation(
  connection: ConnectionState | undefined,
  locations: AvailableLocation[],
): CurrentAvailableLocation | undefined {
  if (connection?.status !== "connected" || !connection.location) return undefined;
  const reported = connection.location.toLowerCase();
  const match = locations.find((location) => location.cities.some((city) => city.toLowerCase() === reported));
  return match ? { code: match.code, city: connection.location } : undefined;
}
