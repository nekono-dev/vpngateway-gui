// 責務: 利用者がお気に入り登録した接続先ID（location-id.ts）の永続化。
// api-dataボリューム上の単一JSONファイルへのread-modify-write（低頻度更新のため。settings-store.tsと同方針で
// 同時書き込みの競合は考慮しない）。ファイルが無い・壊れている場合は空として扱い例外にしない
// （お気に入りを失うだけで、接続操作など他の機能は継続できるため）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { matchesPattern } from "../lib/regex-match.js";
import { providerStatePath } from "../providers/provider-state-paths.js";
import { LOCATION_ID_PATTERN } from "./location-id.js";

/** ベンダー別の保存先（Phase 11: `$STATE_DIR/providers/<ベンダーID>/favorite-locations.json`）。接続先IDはベンダー固有のため分ける。 */
function favoritesFile(providerId: string): string {
  return providerStatePath(providerId, "favorite-locations.json");
}

// 無制限にファイルが肥大化しないための上限。実CLIの接続先数（約80件）に対して十分大きい値。
export const MAX_FAVORITE_LOCATIONS = 200;

// お気に入りの件数が上限を超えるため登録できない、または形式が不正な場合に投げる（HTTP 400へマッピングする）。
export class FavoriteLocationsError extends Error {}

/**
 * 目的: 登録済みのお気に入り接続先IDを読み出す。
 * 入力: providerId(対象のベンダーID)。
 * 出力: 登録順のID配列。未保存・破損（JSON不正・形状不正）の場合は空配列。形式不正なIDは除外する。
 */
export function readFavoriteLocationIds(providerId: string): string[] {
  const file = favoritesFile(providerId);
  if (!existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return [];
    const ids = (parsed as Record<string, unknown>).ids;
    if (!Array.isArray(ids)) return [];
    return ids.filter((id): id is string => typeof id === "string" && matchesPattern(id, LOCATION_ID_PATTERN));
  } catch {
    return [];
  }
}

/**
 * 目的: 接続先をお気に入りに登録する（既に登録済みなら何もしない＝冪等）。
 * 入力: providerId(対象のベンダーID), locationId(接続先ID。`^[a-z]{2}-[a-z0-9-]{1,64}$`)。
 * 出力: なし。
 * 失敗時の方針: 形式不正、または登録数が上限に達している場合はFavoriteLocationsErrorを投げる。
 * 副作用: ベンダー別の保存ファイルへ書き込む（ディレクトリが無ければ作成）。
 */
export function addFavoriteLocation(providerId: string, locationId: string): void {
  if (!matchesPattern(locationId, LOCATION_ID_PATTERN)) {
    throw new FavoriteLocationsError(`invalid location id: ${locationId}`);
  }
  const ids = readFavoriteLocationIds(providerId);
  if (ids.includes(locationId)) return;
  if (ids.length >= MAX_FAVORITE_LOCATIONS) {
    throw new FavoriteLocationsError(`too many favorite locations (max ${MAX_FAVORITE_LOCATIONS})`);
  }
  writeFavorites(providerId, [...ids, locationId]);
}

/**
 * 目的: 接続先のお気に入りを解除する（登録されていなければ何もしない＝冪等）。
 * 入力: providerId(対象のベンダーID), locationId(接続先ID)。形式は検証しない（不正な値は登録されていないため、単に何も起きない）。
 * 副作用: 変更があった場合のみベンダー別の保存ファイルへ書き込む。
 */
export function removeFavoriteLocation(providerId: string, locationId: string): void {
  const ids = readFavoriteLocationIds(providerId);
  if (!ids.includes(locationId)) return;
  writeFavorites(providerId, ids.filter((id) => id !== locationId));
}

function writeFavorites(providerId: string, ids: string[]): void {
  const file = favoritesFile(providerId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ids }));
}
