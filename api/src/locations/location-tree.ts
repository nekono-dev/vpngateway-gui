// 責務: ベンダーの接続先一覧から国行を組み立てる。距離順は distance-annotator に委ねる。
import { toLocationId } from "./location-id.js";

export interface CountryRow {
  readonly country: string;
  readonly countryName: string;
  readonly id: string;
  /** 都市行の ping の最小値。内部の並べ替え根拠であり、応答では公開しない。 */
  readonly pingMs?: number;
  readonly hasServerStage: boolean;
}

export interface LocationTreeInput {
  readonly source: "countryTable" | "cityRows";
  readonly rows: ReadonlyArray<{ country: string; countryName: string; city?: string; pingMs?: number }>;
  readonly pingMeasurable: boolean;
}

/** 国の一覧または都市の一覧から国行を生成する。 */
export function buildCountryRows(input: LocationTreeInput): CountryRow[] {
  const countries = new Map<string, { country: string; countryName: string; pingMs?: number }>();
  for (const row of input.rows) {
    const country = row.country.toLowerCase();
    const current = countries.get(country);
    if (current === undefined) {
      countries.set(country, {
        country,
        countryName: row.countryName,
        ...(input.pingMeasurable && row.city !== undefined && row.pingMs !== undefined ? { pingMs: row.pingMs } : {}),
      });
    } else if (input.pingMeasurable && row.city !== undefined && row.pingMs !== undefined && (current.pingMs === undefined || row.pingMs < current.pingMs)) {
      countries.set(country, { ...current, pingMs: row.pingMs });
    }
  }

  const rows = [...countries.values()].map((country) => ({
    id: toLocationId(country.country, country.countryName),
    country: country.country,
    countryName: country.countryName,
    ...(country.pingMs === undefined ? {} : { pingMs: country.pingMs }),
    hasServerStage: input.source === "countryTable",
  }));
  if (!input.pingMeasurable) return rows;
  return rows.sort((a, b) => {
    if (a.pingMs === undefined && b.pingMs === undefined) return 0;
    if (a.pingMs === undefined) return 1;
    if (b.pingMs === undefined) return -1;
    return a.pingMs - b.pingMs;
  });
}
