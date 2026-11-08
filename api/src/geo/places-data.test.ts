// 責務: 同梱の座標データの読み込みと形の検査を確かめる。
import { describe, expect, it } from "vitest";
import { PLACES, parsePlacesDocument } from "./places-data.js";

describe("同梱の座標データ", () => {
  it("件数は7342件で、東京が日本の首都（区分0）として読める", () => {
    expect(PLACES).toHaveLength(7342);
    const tokyo = PLACES.find((p) => p.key === "JP" && p.capitalTier === 0);
    expect(tokyo?.name).toBe("Tokyo");
  });

  it("コソボは ISO が無いため ADM0_A3 の KOS をキーにする", () => {
    expect(PLACES.some((p) => p.key === "KOS" && p.name === "Pristina")).toBe(true);
  });
});

describe("parsePlacesDocument", () => {
  const valid = {
    source: { dataset: "x", version: "5.1.2", license: "public domain", zipSha256: "0" },
    count: 1,
    columns: ["key", "name", "nameEn", "nameAscii", "population", "latitude", "longitude", "capitalTier"],
    rows: [["JP", "Tokyo", "Tokyo", "Tokyo", 35676000, 35.68, 139.69, 0]],
  };

  it("正しい形なら行を型付きの記録にする", () => {
    expect(parsePlacesDocument(valid)).toEqual([
      { key: "JP", name: "Tokyo", nameEn: "Tokyo", nameAscii: "Tokyo", population: 35676000, latitude: 35.68, longitude: 139.69, capitalTier: 0 },
    ]);
  });

  it("件数と行数が合わなければ例外にする", () => {
    expect(() => parsePlacesDocument({ ...valid, count: 2 })).toThrow();
  });

  it("行の形が違えば例外にする（起動時に失敗させる）", () => {
    expect(() => parsePlacesDocument({ ...valid, rows: [["JP", "Tokyo"]] })).toThrow();
    expect(() => parsePlacesDocument({ ...valid, rows: [["JP", "Tokyo", "Tokyo", "Tokyo", "many", 1, 1, 0]] })).toThrow();
  });

  it("首都の区分は 0・1・null のいずれか", () => {
    expect(() => parsePlacesDocument({ ...valid, rows: [["JP", "Tokyo", "Tokyo", "Tokyo", 1, 1, 1, 2]] })).toThrow();
  });
});
