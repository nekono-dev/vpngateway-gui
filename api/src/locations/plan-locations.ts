// 責務: 契約プランで接続できる接続先（国・都市）の参考一覧を、CLIがキャッシュしたサーバ一覧（JSON）から、
// プロファイルの宣言（`availableLocations`）に従って取り出す。接続先を指定できないプランでも、自動接続で
// どこへ繋がりうるかを画面に出すために使う（選択はできない）。ベンダー固有の形式は宣言側に置き、ここには持たない。

import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { PlanDef } from "../profile/profile.schema.js";

export type AvailableLocationsDef = NonNullable<PlanDef["availableLocations"]>;

export interface PlanLocation {
  // 国コード（サーバ一覧の値そのまま）。
  code: string;
  // 日本語の国名（解決できなければ国コード）。
  name: string;
  cities: string[];
}

const regionNames = new Intl.DisplayNames(["ja"], { type: "region" });

function countryName(code: string, aliases: Record<string, string> | undefined): string {
  try {
    return regionNames.of(aliases?.[code] ?? code) ?? code;
  } catch {
    return code;
  }
}

/**
 * 目的: サーバ一覧から、宣言の条件を満たすサーバがある国と都市を集める。
 * 入力: json(パース済みのサーバ一覧), def(プロファイルの`availableLocations`)。
 * 出力: 国名（日本語）順の配列。形式が想定外なら空配列。
 * 例: extractPlanLocations({ L: [{ C: "JP", T: 0, Y: "Tokyo" }] }, { file: "f", list: "L", country: "C", city: "Y", where: [{ field: "T", equals: 0 }] })
 *     // => [{ code: "JP", name: "日本", cities: ["Tokyo"] }]
 */
export function extractPlanLocations(json: unknown, def: AvailableLocationsDef): PlanLocation[] {
  const servers = (json as Record<string, unknown> | null)?.[def.list];
  if (!Array.isArray(servers)) return [];
  const byCountry = new Map<string, Set<string>>();
  for (const server of servers as Array<Record<string, unknown>>) {
    if (server === null || typeof server !== "object") continue;
    const code = server[def.country];
    if (typeof code !== "string" || code === "") continue;
    if (!(def.where ?? []).every((condition) => server[condition.field] === condition.equals)) continue;
    const cities = byCountry.get(code) ?? new Set<string>();
    const city = def.city === undefined ? undefined : server[def.city];
    if (typeof city === "string" && city !== "") cities.add(city);
    byCountry.set(code, cities);
  }
  return [...byCountry.entries()]
    .map(([code, cities]) => ({ code, name: countryName(code, def.countryAliases), cities: [...cities].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/**
 * 目的: 宣言で指定されたファイルを読み、接続できる接続先の参考一覧を返す。
 * 入力: def(プロファイルの`availableLocations`), providerDir(`<PROVIDER_CACHE_DIR>/<ベンダーID>`)。
 * 出力: 一覧。ファイルが無い・読めない・壊れている場合、またはproviderDirの外を指す場合は空配列
 *       （参考表示のため、失敗してもAPI全体を失敗させない）。
 */
export function readPlanLocations(def: AvailableLocationsDef, providerDir: string): PlanLocation[] {
  const root = resolve(providerDir);
  const file = resolve(root, def.file);
  if (!file.startsWith(root + sep)) return [];
  try {
    return extractPlanLocations(JSON.parse(readFileSync(file, "utf8")), def);
  } catch {
    return [];
  }
}
