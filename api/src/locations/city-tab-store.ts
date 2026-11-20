// 責務: 都市一覧で選択したタブをプロバイダごとに永続化する。
// ファイルが無い・壊れている・値が不正な場合は既定の「最速サーバ」として扱う。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PROVIDER_ID_PATTERN } from "../providers/provider-registry.js";
import { providerStatePath } from "../providers/provider-state-paths.js";

export type CityTab = "fastest" | "select";

const DEFAULT_CITY_TAB: CityTab = "fastest";

function cityTabFile(providerId: string): string {
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    throw new Error(`invalid provider id: ${providerId}`);
  }
  return providerStatePath(providerId, "city-tab.json");
}

/** 都市一覧で使うタブを読み出す。未保存・不正データ・破損時は既定値を返す。 */
export function readCityTab(providerId: string): CityTab {
  const file = cityTabFile(providerId);
  if (!existsSync(file)) return DEFAULT_CITY_TAB;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_CITY_TAB;
    const tab = (parsed as Record<string, unknown>).tab;
    return tab === "fastest" || tab === "select" ? tab : DEFAULT_CITY_TAB;
  } catch {
    return DEFAULT_CITY_TAB;
  }
}

/** 都市一覧で使うタブを保存する。 */
export function saveCityTab(providerId: string, tab: CityTab): void {
  const file = cityTabFile(providerId);
  if (tab !== "fastest" && tab !== "select") {
    throw new Error(`invalid city tab: ${String(tab)}`);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ tab }));
}
