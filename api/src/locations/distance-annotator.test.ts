// 責務: 行への距離の注釈（ping 計測の可否・利用者の場所・国コードの対応・都市の行のお気に入り先頭）を確かめる。
import { describe, expect, it } from "vitest";
import { getGeoIndex } from "../geo/geo-index.js";
import { annotateDistances, type DistanceRow } from "./distance-annotator.js";

const geo = getGeoIndex();
const ALIASES = { UK: "GB", XK: "KOS" };
const base = { pingMeasurable: false, countryAliases: ALIASES, userCountry: "JP" as string | undefined };

const country = (code: string): DistanceRow => ({ country: code, favorite: false });
const city = (code: string, name: string, favorite = false): DistanceRow => ({ country: code, city: name, favorite });

describe("annotateDistances", () => {
  it("ping を計測できるプロバイダでは、順序を変えず距離も付けない（要件 1-3）", () => {
    const rows = [country("us"), country("jp")];
    const result = annotateDistances(rows, { ...base, pingMeasurable: true }, geo);
    expect(result.map((r) => r.country)).toEqual(["us", "jp"]);
    expect(result.every((r) => r.distanceKm === undefined)).toBe(true);
  });

  it("利用者の場所が決まらなければ、順序を変えず距離も付けない（要件 2-3）", () => {
    const rows = [country("us"), country("jp")];
    const result = annotateDistances(rows, { ...base, userCountry: undefined }, geo);
    expect(result.map((r) => r.country)).toEqual(["us", "jp"]);
  });

  it("利用者の国の首都が無ければ（プエルトリコ）、順序を変えず距離も付けない（要件 3-6）", () => {
    const rows = [country("us"), country("jp")];
    const result = annotateDistances(rows, { ...base, userCountry: "PR" }, geo);
    expect(result.map((r) => r.country)).toEqual(["us", "jp"]);
  });

  it("国の行は利用者の国の首都からの距離の近い順に並べ、距離を付ける（要件 1-1・4-1）", () => {
    const rows = [country("us"), country("gb"), country("jp")];
    const result = annotateDistances(rows, base, geo);
    expect(result.map((r) => r.country)).toEqual(["jp", "gb", "us"]);
    expect(result[0].distanceKm).toBe(0);
    expect(result[1].distanceKm).toBeGreaterThan(9000);
  });

  it("国コードの対応（UK→GB）を使って首都を引く", () => {
    const rows = [country("uk"), country("us")];
    const result = annotateDistances(rows, base, geo);
    expect(result.map((r) => r.country)).toEqual(["uk", "us"]);
    expect(result[0].distanceKm).toBeGreaterThan(9000);
  });

  it("XK は KOS（コソボ）として首都を引く", () => {
    const result = annotateDistances([country("xk")], base, geo);
    expect(result[0].distanceKm).toBeDefined();
  });

  it("首都が引けない国の行は距離なしで、距離のある行の後ろに置く（要件 3-5）", () => {
    const rows = [country("pr"), country("us")];
    const result = annotateDistances(rows, base, geo);
    expect(result.map((r) => r.country)).toEqual(["us", "pr"]);
    expect(result[1].distanceKm).toBeUndefined();
  });

  it("都市の行は都市の座標で距離を付け、お気に入りの都市を先頭に置く（要件 1-2・1-4・4-2）", () => {
    const rows = [city("us", "Chicago"), city("us", "Ohio-Unknown"), city("gb", "London"), city("us", "Chicago", true)];
    const result = annotateDistances(rows, base, geo);
    expect(result[0]).toMatchObject({ city: "Chicago", favorite: true });
    expect(result[0].distanceKm).toBeDefined();
    expect(result.at(-1)?.city).toBe("Ohio-Unknown");
    expect(result.at(-1)?.distanceKm).toBeUndefined();
  });

  it("国の行は、お気に入りがあっても先頭配置しない（先頭配置は都市の行だけ）", () => {
    const rows = [country("us"), { country: "gb", favorite: true }];
    const result = annotateDistances(rows, base, geo);
    expect(result.map((r) => r.country)).toEqual(["gb", "us"]);
  });

  it("入力の配列を変えない", () => {
    const rows = [country("us"), country("jp")];
    annotateDistances(rows, base, geo);
    expect(rows.map((r) => r.country)).toEqual(["us", "jp"]);
  });
});
