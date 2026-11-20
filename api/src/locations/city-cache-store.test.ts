import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-city-cache-"));
process.env.STATE_DIR = dir;
const provider = "protonvpn";
const citiesDir = join(dir, "providers", provider, "cities");
const cacheFile = join(citiesDir, "US.json");
const cache = await import("./city-cache-store.js");

describe("city-cache-store", () => {
  beforeEach(() => rmSync(citiesDir, { recursive: true, force: true }));

  it("都市一覧を国ごとに保存して読み出す", () => {
    cache.saveCityList(provider, "US", ["Chicago", "New York"]);
    cache.saveCityList(provider, "JP", ["Tokyo"]);
    expect(cache.readCityList(provider, "US")).toEqual(["Chicago", "New York"]);
    expect(cache.readCityList(provider, "JP")).toEqual(["Tokyo"]);
  });

  it("保存済み一覧を読み取り、再取得用の保存で上書きしない", () => {
    cache.saveCityList(provider, "US", ["Chicago"]);
    const cached = cache.readCityList(provider, "US");
    expect(cached).toEqual(["Chicago"]);
    expect(cache.readCityList(provider, "US")).toEqual(cached);
  });

  it("プロバイダの都市一覧をすべて破棄する", () => {
    cache.saveCityList(provider, "US", ["Chicago"]);
    cache.saveCityList(provider, "JP", ["Tokyo"]);
    cache.saveCityList("adguardvpn", "US", ["Tokyo"]);
    cache.clearCityCache(provider);
    expect(cache.readCityList(provider, "US")).toBeUndefined();
    expect(cache.readCityList(provider, "JP")).toBeUndefined();
    expect(cache.readCityList("adguardvpn", "US")).toEqual(["Tokyo"]);
  });

  it("ファイルが無い・壊れている・形状不正なら未保存として扱う", () => {
    expect(cache.readCityList(provider, "US")).toBeUndefined();
    mkdirSync(citiesDir, { recursive: true });
    writeFileSync(cacheFile, "{not json");
    expect(cache.readCityList(provider, "US")).toBeUndefined();
    writeFileSync(cacheFile, JSON.stringify({ country: "JP", cities: ["Tokyo"] }));
    expect(cache.readCityList(provider, "US")).toBeUndefined();
    writeFileSync(cacheFile, JSON.stringify({ country: "US", cities: ["Chicago", 4] }));
    expect(cache.readCityList(provider, "US")).toBeUndefined();
  });

  it.each(["../x", "../../x"]) ("不正な国コード %s でキャッシュ外を読み取らない", (country) => {
    const outside = resolve(citiesDir, `${country}.json`);
    mkdirSync(dirname(outside), { recursive: true });
    writeFileSync(outside, JSON.stringify({ country, cities: ["SHOULD NOT READ"] }));
    expect(cache.readCityList(provider, country)).toBeUndefined();
    expect(existsSync(outside)).toBe(true);
  });

  it.each(["../x", "../../x"]) ("不正な国コード %s で保存せず例外にする", (country) => {
    const outside = resolve(citiesDir, `${country}.json`);
    rmSync(outside, { force: true });
    expect(() => cache.saveCityList(provider, country, ["SHOULD NOT WRITE"])).toThrow(Error);
    expect(cache.readCityList(provider, country)).toBeUndefined();
    expect(existsSync(outside)).toBe(false);
  });

  it("大文字の国コードを小文字に正規化して保存・読み取りできる", () => {
    cache.saveCityList(provider, "JP", ["Tokyo"]);
    expect(cache.readCityList(provider, "jp")).toEqual(["Tokyo"]);
    expect(cache.readCityList(provider, "JP")).toEqual(["Tokyo"]);
  });
});
