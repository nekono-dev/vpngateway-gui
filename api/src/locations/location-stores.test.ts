// 責務: お気に入り・最後の接続先ストアの単体テスト（保存の冪等性・破損時の挙動・上限）。

import { beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-locations-"));
process.env.STATE_DIR = dir;
const P = "adguardvpn";
const favoritesFile = join(dir, "providers", P, "favorite-locations.json");
const lastFile = join(dir, "providers", P, "last-location.json");
mkdirSync(join(dir, "providers", P), { recursive: true });

const favorites = await import("./favorite-locations-store.js");
const last = await import("./last-location-store.js");

describe("favorite-locations-store", () => {
  beforeEach(() => {
    writeFileSync(favoritesFile, JSON.stringify({ version: 2, items: [] }));
  });

  const tokyo = { id: "jp-tokyo", kind: "city" as const, country: "jp", countryName: "Japan", city: "Tokyo" };

  it("表示名付き項目を保存して読み取る", () => {
    const server = { id: "srv-jp-tokyo-1", kind: "server" as const, country: "jp", countryName: "Japan", city: "Tokyo", serverName: "JP-TK#1" };
    favorites.addFavoriteLocationItem(P, tokyo);
    favorites.addFavoriteLocationItem(P, server);
    expect(favorites.readFavoriteLocations(P)).toEqual([tokyo, server]);
  });

  it("旧形式のID配列を空として扱う", () => {
    writeFileSync(favoritesFile, JSON.stringify({ ids: ["jp-tokyo"] }));
    expect(favorites.readFavoriteLocations(P)).toEqual([]);
  });

  it("不正IDまたは必須項目の欠けた項目を読み飛ばす", () => {
    writeFileSync(favoritesFile, JSON.stringify({ version: 2, items: [tokyo, { ...tokyo, id: "BAD" }, { ...tokyo, countryName: "" }, { id: "us-boston", kind: "city", country: "us", city: "Boston" }] }));
    expect(favorites.readFavoriteLocations(P)).toEqual([tokyo]);
  });

  it("未保存なら空", () => {
    writeFileSync(favoritesFile, "");
    expect(favorites.readFavoriteLocationIds(P)).toEqual([]);
  });

  it("登録は冪等で、登録順を保つ", () => {
    favorites.addFavoriteLocationItem(P, tokyo);
    favorites.addFavoriteLocationItem(P, { ...tokyo, id: "us-las-vegas", country: "us", countryName: "United States", city: "Las Vegas" });
    favorites.addFavoriteLocationItem(P, tokyo);
    expect(favorites.readFavoriteLocationIds(P)).toEqual(["jp-tokyo", "us-las-vegas"]);
  });

  it("解除は冪等で、未登録IDの解除は何も起こさない", () => {
    favorites.addFavoriteLocationItem(P, tokyo);
    favorites.removeFavoriteLocation(P, "jp-tokyo");
    favorites.removeFavoriteLocation(P, "jp-tokyo");
    expect(favorites.readFavoriteLocationIds(P)).toEqual([]);
  });

  it("形式不正なIDの登録は拒否する", () => {
    expect(() => favorites.addFavoriteLocationItem(P, { ...tokyo, id: "Tokyo" })).toThrow(favorites.FavoriteLocationsError);
    expect(() => favorites.addFavoriteLocationItem(P, { ...tokyo, id: "../etc" })).toThrow(favorites.FavoriteLocationsError);
  });

  it("上限に達すると登録を拒否する", () => {
    const items = Array.from({ length: favorites.MAX_FAVORITE_LOCATIONS }, (_, i) => ({ ...tokyo, id: `jp-city-${i}` }));
    writeFileSync(favoritesFile, JSON.stringify({ version: 2, items }));
    expect(() => favorites.addFavoriteLocationItem(P, { ...tokyo, id: "jp-one-more" })).toThrow(/too many/);
    expect(favorites.readFavoriteLocations(P)).toHaveLength(200);
  });

  it("破損したファイルは空として扱い、形式不正な要素は除外する", () => {
    writeFileSync(favoritesFile, "{not json");
    expect(favorites.readFavoriteLocationIds(P)).toEqual([]);
    writeFileSync(favoritesFile, JSON.stringify({ version: 2, items: [tokyo, 5, { ...tokyo, id: "BAD" }] }));
    expect(favorites.readFavoriteLocationIds(P)).toEqual(["jp-tokyo"]);
  });
});

describe("last-location-store", () => {
  it("保存した接続先IDを読み出せ、上書きできる", () => {
    last.saveLastLocationId(P, "jp-tokyo");
    expect(last.readLastLocationId(P)).toBe("jp-tokyo");
    last.saveLastLocationId(P, "us-las-vegas");
    expect(last.readLastLocationId(P)).toBe("us-las-vegas");
  });

  it("破損・形式不正はundefined", () => {
    writeFileSync(lastFile, "{not json");
    expect(last.readLastLocationId(P)).toBeUndefined();
    writeFileSync(lastFile, JSON.stringify({ id: "BAD ID" }));
    expect(last.readLastLocationId(P)).toBeUndefined();
  });
});
