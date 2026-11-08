// 責務: 距離による並べ替えの規則（お気に入りの先頭・距離順・距離の無い行の末尾・同距離の元の順序）を確かめる。
import { describe, expect, it } from "vitest";
import { rankByDistance } from "./rank-by-distance.js";

const BASIS = { latitude: 35.6895, longitude: 139.6917 }; // 東京
const TOKYO = { latitude: 35.6895, longitude: 139.6917 };
const OSAKA = { latitude: 34.6937, longitude: 135.5023 };
const LONDON = { latitude: 51.5019, longitude: -0.1187 };

type Row = { id: string; coordinate?: { latitude: number; longitude: number }; favorite?: boolean };
const options = {
  basis: BASIS,
  coordinateOf: (row: Row) => row.coordinate,
  favoriteFirst: (row: Row) => row.favorite === true,
};

describe("rankByDistance", () => {
  it("距離の近い順に並べ、距離を小数点以下第一位で付ける", () => {
    const rows: Row[] = [{ id: "london", coordinate: LONDON }, { id: "osaka", coordinate: OSAKA }];
    const ranked = rankByDistance(rows, options);
    expect(ranked.map((r) => r.id)).toEqual(["osaka", "london"]);
    expect(ranked[0].distanceKm).toBeCloseTo(396.4, 1);
  });

  it("距離の決まらない行は、距離のある行の後ろに元の順序のまま置く", () => {
    const rows: Row[] = [{ id: "none-1" }, { id: "london", coordinate: LONDON }, { id: "none-2" }];
    const ranked = rankByDistance(rows, options);
    expect(ranked.map((r) => r.id)).toEqual(["london", "none-1", "none-2"]);
    expect(ranked[1].distanceKm).toBeUndefined();
  });

  it("同じ距離の行は元の順序を保つ", () => {
    const rows: Row[] = [{ id: "a", coordinate: TOKYO }, { id: "b", coordinate: TOKYO }];
    expect(rankByDistance(rows, options).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("お気に入りの行は距離より前に、元の相対順序のまま置く", () => {
    const rows: Row[] = [
      { id: "london", coordinate: LONDON },
      { id: "fav-london", coordinate: LONDON, favorite: true },
      { id: "fav-osaka", coordinate: OSAKA, favorite: true },
      { id: "osaka", coordinate: OSAKA },
    ];
    expect(rankByDistance(rows, options).map((r) => r.id)).toEqual(["fav-london", "fav-osaka", "osaka", "london"]);
  });

  it("入力の配列を変えない", () => {
    const rows: Row[] = [{ id: "london", coordinate: LONDON }, { id: "osaka", coordinate: OSAKA }];
    const snapshot = rows.map((r) => r.id);
    rankByDistance(rows, options);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});
