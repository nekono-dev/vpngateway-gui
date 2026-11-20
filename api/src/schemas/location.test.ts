// 責務: 階層別ロケーション応答の形と、既存の国行フィールドを検証する。
import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  CityRowSchema,
  CityTabResponseSchema,
  CountryRowSchema,
  FavoriteItemSchema,
  LocationSchema,
  LocationsRefreshResponseSchema,
  ServerRowSchema,
} from "./location.js";

describe("ロケーション応答スキーマ", () => {
  it("既存の国行フィールドを維持し、都市行は距離を任意に持つ", () => {
    const country = { id: "jp", country: "jp", countryName: "日本", favorite: false, lastConnected: false };
    const city = { ...country, city: "TOKYO" };
    expect(Value.Check(LocationSchema, country)).toBe(true);
    expect(Value.Check(CityRowSchema, city)).toBe(true);
    expect(Value.Check(CityRowSchema, { ...city, distanceKm: 8312.4 })).toBe(true);
    expect(Value.Check(CityRowSchema, { ...city, distanceKm: "8312" })).toBe(false);
    expect(Object.keys(LocationSchema.properties)).toEqual([
      "id", "country", "countryName", "city", "pingMs", "distanceKm", "favorite", "lastConnected",
    ]);
  });

  it("国の行はステージ情報を持ち、pingを応答に含めない", () => {
    const row = { id: "jp", country: "jp", countryName: "日本", hasServerStage: true, favorite: false, lastConnected: false };
    expect(Value.Check(CountryRowSchema, row)).toBe(true);
    expect(Value.Check(CountryRowSchema, { ...row, pingMs: 12 })).toBe(false);
  });

  it("サーバ・お気に入り・タブ・再計測応答の形を検証する", () => {
    expect(Value.Check(ServerRowSchema, { name: "JP#1", tier: "paid", load: 15, score: 3, favorite: true, connected: false })).toBe(true);
    expect(Value.Check(FavoriteItemSchema, { id: "jp-tokyo", kind: "city", country: "jp", countryName: "日本", city: "TOKYO" })).toBe(true);
    expect(Value.Check(FavoriteItemSchema, { id: "srv-jp-1", kind: "server", country: "jp", countryName: "日本", city: "TOKYO", serverName: "JP#1" })).toBe(true);
    expect(Value.Check(CityTabResponseSchema, { tab: "fastest" })).toBe(true);
    expect(Value.Check(CityTabResponseSchema, { tab: "select" })).toBe(true);
    expect(Value.Check(LocationsRefreshResponseSchema, [ { id: "jp", country: "jp", countryName: "日本", hasServerStage: false, favorite: false, lastConnected: false } ])).toBe(true);
  });
});
