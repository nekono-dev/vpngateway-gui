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
    writeFileSync(favoritesFile, JSON.stringify({ ids: [] }));
  });

  it("未保存なら空", () => {
    writeFileSync(favoritesFile, "");
    expect(favorites.readFavoriteLocationIds(P)).toEqual([]);
  });

  it("登録は冪等で、登録順を保つ", () => {
    favorites.addFavoriteLocation(P, "jp-tokyo");
    favorites.addFavoriteLocation(P, "us-las-vegas");
    favorites.addFavoriteLocation(P, "jp-tokyo");
    expect(favorites.readFavoriteLocationIds(P)).toEqual(["jp-tokyo", "us-las-vegas"]);
  });

  it("解除は冪等で、未登録IDの解除は何も起こさない", () => {
    favorites.addFavoriteLocation(P, "jp-tokyo");
    favorites.removeFavoriteLocation(P, "jp-tokyo");
    favorites.removeFavoriteLocation(P, "jp-tokyo");
    expect(favorites.readFavoriteLocationIds(P)).toEqual([]);
  });

  it("形式不正なIDの登録は拒否する", () => {
    expect(() => favorites.addFavoriteLocation(P, "Tokyo")).toThrow(favorites.FavoriteLocationsError);
    expect(() => favorites.addFavoriteLocation(P, "../etc")).toThrow(favorites.FavoriteLocationsError);
  });

  it("上限に達すると登録を拒否する", () => {
    const ids = Array.from({ length: favorites.MAX_FAVORITE_LOCATIONS }, (_, i) => `jp-city-${i}`);
    writeFileSync(favoritesFile, JSON.stringify({ ids }));
    expect(() => favorites.addFavoriteLocation(P, "jp-one-more")).toThrow(/too many/);
    // 登録済みなら上限でも冪等に成功する
    expect(() => favorites.addFavoriteLocation(P, "jp-city-0")).not.toThrow();
  });

  it("破損したファイルは空として扱い、形式不正な要素は除外する", () => {
    writeFileSync(favoritesFile, "{not json");
    expect(favorites.readFavoriteLocationIds(P)).toEqual([]);
    writeFileSync(favoritesFile, JSON.stringify({ ids: ["jp-tokyo", 5, "BAD"] }));
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
