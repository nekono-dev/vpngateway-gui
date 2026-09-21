// 責務: お気に入り・最後の接続先ストアの単体テスト（保存の冪等性・破損時の挙動・上限）。

import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-locations-"));
process.env.FAVORITE_LOCATIONS_FILE = join(dir, "favorite-locations.json");
process.env.LAST_LOCATION_FILE = join(dir, "last-location.json");

const favorites = await import("./favorite-locations-store.js");
const last = await import("./last-location-store.js");

describe("favorite-locations-store", () => {
  beforeEach(() => {
    writeFileSync(process.env.FAVORITE_LOCATIONS_FILE!, JSON.stringify({ ids: [] }));
  });

  it("未保存なら空", () => {
    writeFileSync(process.env.FAVORITE_LOCATIONS_FILE!, "");
    expect(favorites.readFavoriteLocationIds()).toEqual([]);
  });

  it("登録は冪等で、登録順を保つ", () => {
    favorites.addFavoriteLocation("jp-tokyo");
    favorites.addFavoriteLocation("us-las-vegas");
    favorites.addFavoriteLocation("jp-tokyo");
    expect(favorites.readFavoriteLocationIds()).toEqual(["jp-tokyo", "us-las-vegas"]);
  });

  it("解除は冪等で、未登録IDの解除は何も起こさない", () => {
    favorites.addFavoriteLocation("jp-tokyo");
    favorites.removeFavoriteLocation("jp-tokyo");
    favorites.removeFavoriteLocation("jp-tokyo");
    expect(favorites.readFavoriteLocationIds()).toEqual([]);
  });

  it("形式不正なIDの登録は拒否する", () => {
    expect(() => favorites.addFavoriteLocation("Tokyo")).toThrow(favorites.FavoriteLocationsError);
    expect(() => favorites.addFavoriteLocation("../etc")).toThrow(favorites.FavoriteLocationsError);
  });

  it("上限に達すると登録を拒否する", () => {
    const ids = Array.from({ length: favorites.MAX_FAVORITE_LOCATIONS }, (_, i) => `jp-city-${i}`);
    writeFileSync(process.env.FAVORITE_LOCATIONS_FILE!, JSON.stringify({ ids }));
    expect(() => favorites.addFavoriteLocation("jp-one-more")).toThrow(/too many/);
    // 登録済みなら上限でも冪等に成功する
    expect(() => favorites.addFavoriteLocation("jp-city-0")).not.toThrow();
  });

  it("破損したファイルは空として扱い、形式不正な要素は除外する", () => {
    writeFileSync(process.env.FAVORITE_LOCATIONS_FILE!, "{not json");
    expect(favorites.readFavoriteLocationIds()).toEqual([]);
    writeFileSync(process.env.FAVORITE_LOCATIONS_FILE!, JSON.stringify({ ids: ["jp-tokyo", 5, "BAD"] }));
    expect(favorites.readFavoriteLocationIds()).toEqual(["jp-tokyo"]);
  });
});

describe("last-location-store", () => {
  it("保存した接続先IDを読み出せ、上書きできる", () => {
    last.saveLastLocationId("jp-tokyo");
    expect(last.readLastLocationId()).toBe("jp-tokyo");
    last.saveLastLocationId("us-las-vegas");
    expect(last.readLastLocationId()).toBe("us-las-vegas");
  });

  it("破損・形式不正はundefined", () => {
    writeFileSync(process.env.LAST_LOCATION_FILE!, "{not json");
    expect(last.readLastLocationId()).toBeUndefined();
    writeFileSync(process.env.LAST_LOCATION_FILE!, JSON.stringify({ id: "BAD ID" }));
    expect(last.readLastLocationId()).toBeUndefined();
  });
});
