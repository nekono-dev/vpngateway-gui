// 責務: 同梱データから、国の首都と都市の座標を引く（国の識別キーと都市名で照合する）。国の選択肢も返す。
// 純粋な照合の規則（区分・人口順・名前の正規化）だけを持ち、外部の通信や保存は行わない。

import type { Coordinate } from "./great-circle.js";
import { PLACES, type PlaceRecord } from "./places-data.js";

/** 国の選択肢（設定画面の一覧に出す一件）。 */
export interface CountryOption {
  readonly code: string;
  readonly name: string;
}

/** 座標の照合の窓口。 */
export interface GeoIndex {
  hasCountry(countryKey: string): boolean;
  capitalOf(countryKey: string): Coordinate | undefined;
  cityOf(countryKey: string, cityName: string): Coordinate | undefined;
  countryOptions(): readonly CountryOption[];
}

// ISO 3166-1 alpha-2 を持たない国の日本語の名前（同梱データの識別キーに対応）。
const NON_ISO_COUNTRY_NAMES: Readonly<Record<string, string>> = { KOS: "コソボ" };

const regionNames = new Intl.DisplayNames(["ja"], { type: "region" });

/**
 * 目的: 国の識別キーから表示名を決める（ISO 3166-1 alpha-2 は日本語の名前、それ以外は既知の名前、無ければキー）。
 * 入力: code（国の識別キー）。
 * 出力: 表示名。
 */
function countryDisplayName(code: string): string {
  const known = NON_ISO_COUNTRY_NAMES[code];
  if (known !== undefined) return known;
  if (!/^[A-Z]{2}$/.test(code)) return code;
  return regionNames.of(code) ?? code;
}

/**
 * 目的: 名前を照合用に正規化する（Unicode の分解、結合記号の除去、小文字化、英数字以外の除去）。
 * 入力: name（都市名などの文字列）。
 * 出力: 正規化した文字列。英数字が一つも無ければ空文字（空どうしを一致させない）。
 * 例: normalizeName("Bogotá") // => "bogota"
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * 目的: 同梱データの記録から、照合用の索引を作る。
 * 入力: places（同梱データの記録の配列）。
 * 出力: GeoIndex。
 * 規則: 首都は区分 0 の記録のうち人口の最も多いもの、無ければ区分 1 のうち人口の最も多いもの。
 *       都市は、国の識別キーが一致し、名称・英語名・ASCII 名のいずれかが正規化して一致する記録のうち人口の最も多いもの。
 */
export function createGeoIndex(places: readonly PlaceRecord[]): GeoIndex {
  const byKey = new Map<string, PlaceRecord[]>();
  for (const place of places) {
    const list = byKey.get(place.key) ?? [];
    list.push(place);
    byKey.set(place.key, list);
  }

  const largest = (list: readonly PlaceRecord[]): PlaceRecord | undefined =>
    list.reduce<PlaceRecord | undefined>((best, p) => (best === undefined || p.population > best.population ? p : best), undefined);

  const capitals = new Map<string, PlaceRecord>();
  for (const [key, list] of byKey) {
    const capital =
      largest(list.filter((p) => p.capitalTier === 0)) ?? largest(list.filter((p) => p.capitalTier === 1));
    if (capital !== undefined) capitals.set(key, capital);
  }

  const toCoordinate = (p: PlaceRecord): Coordinate => ({ latitude: p.latitude, longitude: p.longitude });

  return {
    hasCountry: (countryKey) => capitals.has(countryKey),
    capitalOf: (countryKey) => {
      const capital = capitals.get(countryKey);
      return capital === undefined ? undefined : toCoordinate(capital);
    },
    cityOf: (countryKey, cityName) => {
      const target = normalizeName(cityName);
      if (target === "") return undefined;
      const matches = (byKey.get(countryKey) ?? []).filter(
        (p) =>
          normalizeName(p.name) === target ||
          normalizeName(p.nameAscii) === target ||
          normalizeName(p.nameEn) === target,
      );
      const best = largest(matches);
      return best === undefined ? undefined : toCoordinate(best);
    },
    countryOptions: () =>
      [...capitals.keys()]
        .map((code): CountryOption => ({ code, name: countryDisplayName(code) }))
        .sort((a, b) => a.name.localeCompare(b.name, "ja")),
  };
}

let shared: GeoIndex | undefined;

/**
 * 目的: 同梱データから作った索引を返す（初回の呼び出しで作り、以後は同じものを返す）。
 * 出力: GeoIndex。
 */
export function getGeoIndex(): GeoIndex {
  shared ??= createGeoIndex(PLACES);
  return shared;
}
