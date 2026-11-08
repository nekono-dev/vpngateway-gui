// 責務: 表示名を含むお気に入りをプロバイダ別のJSONファイルへ永続化する。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { matchesPattern } from "../lib/regex-match.js";
import { providerStatePath } from "../providers/provider-state-paths.js";
import { LOCATION_ID_PATTERN } from "./location-id.js";

export const MAX_FAVORITE_LOCATIONS = 200;
export const FAVORITES_VERSION = 2;
export type FavoriteLocation = {
  id: string;
  kind: "city" | "server";
  country: string;
  countryName: string;
  city: string;
  serverName?: string;
};
export class FavoriteLocationsError extends Error {}

function favoritesFile(providerId: string): string {
  return providerStatePath(providerId, "favorite-locations.json");
}

function isFavoriteLocation(value: unknown): value is FavoriteLocation {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && matchesPattern(item.id, LOCATION_ID_PATTERN)
    && (item.kind === "city" || item.kind === "server")
    && typeof item.country === "string" && item.country.length > 0
    && typeof item.countryName === "string" && item.countryName.length > 0
    && typeof item.city === "string" && item.city.length > 0
    && (item.serverName === undefined || (typeof item.serverName === "string" && item.serverName.length > 0));
}

export function readFavoriteLocations(providerId: string): FavoriteLocation[] {
  const file = favoritesFile(providerId);
  if (!existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return [];
    const data = parsed as Record<string, unknown>;
    if (data.version !== FAVORITES_VERSION || !Array.isArray(data.items)) return [];
    return data.items.filter(isFavoriteLocation);
  } catch {
    return [];
  }
}

// 既存の読み手との互換 API。表示名を必要とする処理は readFavoriteLocations を使う。
export function readFavoriteLocationIds(providerId: string): string[] {
  return readFavoriteLocations(providerId).map(({ id }) => id);
}

export function addFavoriteLocationItem(providerId: string, item: FavoriteLocation): void {
  if (!isFavoriteLocation(item)) throw new FavoriteLocationsError("invalid favorite location");
  const items = readFavoriteLocations(providerId);
  const index = items.findIndex(({ id }) => id === item.id);
  if (index >= 0) items[index] = item;
  else {
    if (items.length >= MAX_FAVORITE_LOCATIONS) {
      throw new FavoriteLocationsError(`too many favorite locations (max ${MAX_FAVORITE_LOCATIONS})`);
    }
    items.push(item);
  }
  writeFavorites(providerId, items);
}

// 既存ルート用。新規項目はメタデータが必要なため、IDだけの追加は拒否する。
export function addFavoriteLocation(providerId: string, locationId: string): void {
  if (!matchesPattern(locationId, LOCATION_ID_PATTERN) || locationId.startsWith("srv-")) {
    throw new FavoriteLocationsError(`invalid location id: ${locationId}`);
  }
  const [country = "", ...parts] = locationId.split("-");
  const city = parts.join(" ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  addFavoriteLocationItem(providerId, {
    id: locationId,
    kind: "city",
    country,
    countryName: country.toUpperCase(),
    city,
  });
}

export function removeFavoriteLocation(providerId: string, locationId: string): void {
  const items = readFavoriteLocations(providerId);
  const filtered = items.filter(({ id }) => id !== locationId);
  if (filtered.length !== items.length) writeFavorites(providerId, filtered);
}

function writeFavorites(providerId: string, items: FavoriteLocation[]): void {
  const file = favoritesFile(providerId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: FAVORITES_VERSION, items }));
}
