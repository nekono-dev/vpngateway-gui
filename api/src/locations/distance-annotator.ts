// 責務: 一覧の行に、利用者の国の首都からの距離を付け、ping を計測できないプロバイダでだけ距離順に並べる。
// 行の組み立て・取得・保存は行わない（呼び出し側が行を渡す）。国コードの対応はプロファイルの共通の対応を使う。

import type { GeoIndex } from "../geo/geo-index.js";
import { rankByDistance } from "./rank-by-distance.js";

/** 注釈の対象になる行の最小の形（国の行は city を持たない）。 */
export interface DistanceRow {
  // ベンダーの国コード（小文字。例: "jp"・"uk"）。
  readonly country: string;
  // 都市の行のみ。
  readonly city?: string;
  readonly favorite: boolean;
}

/** 注釈の文脈。 */
export interface DistanceContext {
  // ping を計測できるか（プロファイルの宣言から判定した値）。true なら距離の注釈も並べ替えもしない。
  readonly pingMeasurable: boolean;
  // ベンダーの国コード（大文字）→ 同梱データの国の識別キー。
  readonly countryAliases: Readonly<Record<string, string>>;
  // 解決済みの利用者の国（ISO 2 文字の大文字）。決まらなければ undefined。
  readonly userCountry: string | undefined;
}

/**
 * 目的: 行に距離を付け、距離の規則で並べ替える（ping を計測できないときだけ）。
 * 入力: rows（一覧の行。変更しない）, context（ping 計測・利用者の国・国コードの対応）, geo（座標の照合）。
 * 出力: 新しい配列。次のいずれかのとき、行の順序を変えず、距離も付けない:
 *       ping を計測できる／利用者の国が決まらない／利用者の国の首都が引けない。
 *       それ以外は、国の行は国の首都、都市の行は都市の座標で距離を付け、距離の規則で並べる（都市の行のお気に入りは先頭）。
 *       座標が引けない行は距離なしで末尾に置く。
 */
export function annotateDistances<T extends DistanceRow>(
  rows: readonly T[],
  context: DistanceContext,
  geo: GeoIndex,
): Array<T & { distanceKm?: number }> {
  const unchanged = (): Array<T & { distanceKm?: number }> => rows.map((row) => ({ ...row }));
  if (context.pingMeasurable || context.userCountry === undefined) return unchanged();

  const keyOf = (country: string): string => {
    const code = country.toUpperCase();
    return context.countryAliases[code] ?? code;
  };
  const basis = geo.capitalOf(keyOf(context.userCountry));
  if (basis === undefined) return unchanged();

  return rankByDistance(rows, {
    basis,
    coordinateOf: (row) =>
      row.city === undefined ? geo.capitalOf(keyOf(row.country)) : geo.cityOf(keyOf(row.country), row.city),
    favoriteFirst: (row) => row.city !== undefined && row.favorite,
  });
}
