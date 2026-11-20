// 責務: 二点の地球表面上の最短距離（大圏距離・km）と、表示用の丸め（小数点以下第一位）を行う純粋関数。
// 外部の依存は使わない（球面の近似: 平均半径 6371.0088 km の Haversine 式）。

/** 緯度・経度（度）。緯度は -90〜90、経度は -180〜180 を想定する。 */
export interface Coordinate {
  readonly latitude: number;
  readonly longitude: number;
}

const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * 目的: 二点間の大圏距離（km）を求める。
 * 入力: from・to（座標。有限な数であること）。
 * 出力: 距離（km）。同一点は 0、入れ替えても同じ値。
 * 失敗時の方針: 有限でない座標は RangeError を投げる（黙って NaN を返さない）。
 */
export function greatCircleKm(from: Coordinate, to: Coordinate): number {
  for (const value of [from.latitude, from.longitude, to.latitude, to.longitude]) {
    if (!Number.isFinite(value)) throw new RangeError("座標は有限な数である必要がある");
  }
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * 目的: 距離を表示用に小数点以下第一位へ丸める。
 * 入力: km（距離）。
 * 出力: 小数点以下第一位へ丸めた値（例: 1234.56 → 1234.6）。
 */
export function roundToTenth(km: number): number {
  return Math.round(km * 10) / 10;
}
