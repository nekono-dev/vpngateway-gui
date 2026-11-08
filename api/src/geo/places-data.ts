// 責務: 同梱の座標データ（places.json）を読み込み、形を検査して型付きの記録の配列として提供する。
// 形が想定と違えばモジュールの読み込み時に例外を投げ、起動を失敗させる（ビルドの欠陥を実行時に隠さない）。
import data from "./places.json" with { type: "json" };

/** 同梱データの一件（国の首都・都市の一件）。 */
export interface PlaceRecord {
  // 国の識別キー（ISO 3166-1 alpha-2。対応が無いものは ADM0_A3。例: "JP"・"KOS"）。
  readonly key: string;
  readonly name: string;
  readonly nameEn: string;
  readonly nameAscii: string;
  // 人口（データ源の POP_MAX）。
  readonly population: number;
  readonly latitude: number;
  readonly longitude: number;
  // 首都の区分: 0 = Admin-0 capital、1 = Admin-0 region capital、undefined = それ以外。
  readonly capitalTier: 0 | 1 | undefined;
}

const COLUMN_COUNT = 8;

/**
 * 目的: 同梱データの値を検査し、型付きの記録の配列にする。
 * 入力: value（JSON を読んだ値。未検査）。
 * 出力: PlaceRecord の配列（行の順序を保つ）。
 * 失敗時の方針: 件数の不一致・行の形の不一致・値の型の不一致は Error を投げる（起動時に検出する）。
 */
export function parsePlacesDocument(value: unknown): PlaceRecord[] {
  if (typeof value !== "object" || value === null) throw new Error("places.json: オブジェクトではない");
  const doc = value as { count?: unknown; rows?: unknown };
  if (typeof doc.count !== "number" || !Array.isArray(doc.rows)) {
    throw new Error("places.json: count と rows が無い");
  }
  if (doc.rows.length !== doc.count) {
    throw new Error(`places.json: 件数が一致しない（count=${doc.count}, rows=${doc.rows.length}）`);
  }
  return doc.rows.map((row: unknown, index: number): PlaceRecord => {
    if (!Array.isArray(row) || row.length !== COLUMN_COUNT) {
      throw new Error(`places.json: ${index} 行目の列数が ${COLUMN_COUNT} ではない`);
    }
    const [key, name, nameEn, nameAscii, population, latitude, longitude, capitalTier] = row as unknown[];
    const isString = (v: unknown): v is string => typeof v === "string";
    const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    if (!isString(key) || !isString(name) || !isString(nameEn) || !isString(nameAscii)) {
      throw new Error(`places.json: ${index} 行目の文字列の項目が不正`);
    }
    if (!isNumber(population) || !isNumber(latitude) || !isNumber(longitude)) {
      throw new Error(`places.json: ${index} 行目の数値の項目が不正`);
    }
    if (capitalTier !== null && capitalTier !== 0 && capitalTier !== 1) {
      throw new Error(`places.json: ${index} 行目の首都の区分が不正`);
    }
    return {
      key,
      name,
      nameEn,
      nameAscii,
      population,
      latitude,
      longitude,
      capitalTier: capitalTier === null ? undefined : capitalTier,
    };
  });
}

/** 同梱データ（モジュールの読み込み時に一度だけ検査して作る）。 */
export const PLACES: readonly PlaceRecord[] = parsePlacesDocument(data);
