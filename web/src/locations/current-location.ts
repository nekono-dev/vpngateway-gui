// 責務: 「現在の接続先」と「実効選択（接続/変更ボタンの対象）」を、接続状態と接続先一覧から決める純粋関数。
// 実効選択の優先順位は webserver/design.md「選択・ボタンの状態遷移」。

import type { ConnectionState } from "../hooks/useDashboardPolling";
import type { LocationItem } from "./location-filter";

/**
 * 目的: 現在接続中の接続先IDを特定する。
 * 入力: connection(`GET /v1/connection`の応答。未取得ならundefined), locations(接続先一覧)。
 * 出力: 接続中でなければundefined。接続中でAPIが`locationId`を返していればそれ。返さない場合
 *       （API外での接続・保存内容なし）は、CLIが報告する都市名(`location`)と一覧の`city`を、
 *       大文字小文字を区別せず突き合わせて見つかったID。特定できなければundefined。
 * 例: findCurrentLocationId({ status: "connected", location: "TOKYO" }, [{ id: "jp-tokyo", city: "Tokyo", ... }]) // => "jp-tokyo"
 */
export function findCurrentLocationId(
  connection: ConnectionState | undefined,
  locations: LocationItem[],
): string | undefined {
  if (connection?.status !== "connected") return undefined;
  if (connection.locationId) return connection.locationId;
  const reported = connection.location?.toLowerCase();
  if (!reported) return undefined;
  return locations.find((location) => location.city?.toLowerCase() === reported)?.id;
}

/**
 * 目的: 接続/変更ボタンの対象となる接続先ID（実効選択）を決める。
 * 入力: selectedId(利用者が明示的に選んだID), currentId(現在の接続先ID。切断中はundefined),
 *       lastConnectedId(最後に接続した接続先ID), locations(接続先一覧)。
 * 出力: selectedId → 現在の接続先(接続中) → 最後に接続した接続先(切断中) の優先順で、一覧に存在する最初のID。
 *       どれも一覧に存在しなければundefined（対象なし＝接続できない）。
 * 例: resolveEffectiveId(undefined, undefined, "jp-tokyo", locations) // => "jp-tokyo"
 */
export function resolveEffectiveId(
  selectedId: string | undefined,
  currentId: string | undefined,
  lastConnectedId: string | undefined,
  locations: LocationItem[],
): string | undefined {
  const candidates = [selectedId, currentId ?? lastConnectedId];
  return candidates.find((id) => id !== undefined && locations.some((location) => location.id === id));
}
