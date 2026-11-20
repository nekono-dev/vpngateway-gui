// 責務: プロバイダごと・国ごとの都市一覧を永続化し、再計測時にプロバイダ分を破棄する。
// ファイルが無い・壊れている場合は未保存として扱い、都市一覧の取得を継続できるよう例外にしない。

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { providerStatePath } from "../providers/provider-state-paths.js";

function normalizeCountryCode(country: string): string | undefined {
  const normalized = country.toLowerCase();
  return /^[a-z]{2}$/.test(normalized) ? normalized : undefined;
}

function cityListFile(providerId: string, country: string): string {
  return providerStatePath(providerId, join("cities", `${country}.json`));
}

/** 保存済み都市一覧を返す。ファイル不在・JSON不正・形式不正・国コード不一致は undefined。 */
export function readCityList(providerId: string, country: string): string[] | undefined {
  const normalizedCountry = normalizeCountryCode(country);
  if (!normalizedCountry) return undefined;
  const file = cityListFile(providerId, normalizedCountry);
  if (!existsSync(file)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    if (record.country !== normalizedCountry || !Array.isArray(record.cities) || !record.cities.every((city) => typeof city === "string")) {
      return undefined;
    }
    return record.cities;
  } catch {
    return undefined;
  }
}

/** 都市一覧を国ごとの JSON ファイルへ保存する。 */
export function saveCityList(providerId: string, country: string, cities: readonly string[]): void {
  const normalizedCountry = normalizeCountryCode(country);
  if (!normalizedCountry) throw new Error(`Invalid country code: ${country}`);
  const file = cityListFile(providerId, normalizedCountry);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ country: normalizedCountry, cities }));
}

/** 再計測時に対象プロバイダの全国分の都市一覧を破棄する。 */
export function clearCityCache(providerId: string): void {
  const directory = providerStatePath(providerId, "cities");
  rmSync(directory, { recursive: true, force: true });
}
