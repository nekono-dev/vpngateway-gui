// 責務: 行の配列を、距離の規則（お気に入りの先頭・距離の近い順・距離の無い行の末尾・同距離は元の順序）で並べ替える純粋関数。
// 行の組み立てや取得は行わない（呼び出し側が座標と先頭配置の判定を渡す）。

import { greatCircleKm, roundToTenth, type Coordinate } from "../geo/great-circle.js";

/** 並べ替えの指定。 */
export interface RankOptions<T> {
  // 利用者の国の首都（距離の基点）。
  readonly basis: Coordinate;
  // 行の座標（都市の行は都市、国の行は首都）。引けなければ undefined。
  readonly coordinateOf: (row: T) => Coordinate | undefined;
  // true の行は距離より前に、元の相対順序のまま置く（都市の一覧のお気に入り）。
  readonly favoriteFirst: (row: T) => boolean;
}

/** 距離を付けた行の型。距離の無い行には distanceKm が無い。 */
type Ranked<T> = T & { distanceKm?: number };

/**
 * 目的: 行のコピーに距離（あれば）を付ける（ジェネリックな行のスプレッドの型を、ここで一度だけ確定させる）。
 * 入力: row（行。変更しない）, km（距離。undefined なら距離を付けない）。
 * 出力: 新しいオブジェクト。
 */
function withDistance<T>(row: T, km: number | undefined): Ranked<T> {
  // スプレッドの結果は T の部分型であり、distanceKm は任意項目のため、この型に一致する。
  return (km === undefined ? { ...row } : { ...row, distanceKm: km }) as Ranked<T>;
}

/**
 * 目的: 行を距離の規則で並べ替え、距離（小数点以下第一位）を付ける。
 * 入力: rows（並べ替える行。変更しない）, options（基点・座標・先頭配置の判定）。
 * 出力: 新しい配列。並びは「先頭配置の行（元の順）→ 距離の小さい順（同距離は元の順）→ 距離の無い行（元の順）」。
 *       距離のある行には distanceKm を付ける。距離の無い行には付けない。
 */
export function rankByDistance<T>(
  rows: readonly T[],
  options: RankOptions<T>,
): Array<T & { distanceKm?: number }> {
  const pinned: Array<T & { distanceKm?: number }> = [];
  const measured: Array<{ row: T & { distanceKm?: number }; km: number; index: number }> = [];
  const unmeasured: Array<T & { distanceKm?: number }> = [];

  rows.forEach((row, index) => {
    const coordinate = options.coordinateOf(row);
    const km = coordinate === undefined ? undefined : roundToTenth(greatCircleKm(options.basis, coordinate));
    if (options.favoriteFirst(row)) {
      pinned.push(withDistance(row, km));
    } else if (km === undefined) {
      unmeasured.push(withDistance(row, undefined));
    } else {
      measured.push({ row: withDistance(row, km), km, index });
    }
  });

  // 同じ距離は元の順序を保つ（index で決定的に並べる）。
  measured.sort((a, b) => a.km - b.km || a.index - b.index);
  return [...pinned, ...measured.map((m) => m.row), ...unmeasured];
}
