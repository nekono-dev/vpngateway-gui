// 責務: 国の首都と都市の照合（区分・人口順・英語名・正規化）を、同梱データで確かめる。
import { describe, expect, it } from "vitest";
import { PLACES } from "./places-data.js";
import { createGeoIndex, getGeoIndex } from "./geo-index.js";

const index = createGeoIndex(PLACES);

describe("国の首都", () => {
  it("東京が日本の首都", () => {
    const tokyo = index.capitalOf("JP");
    expect(tokyo?.latitude).toBeCloseTo(35.68, 1);
    expect(tokyo?.longitude).toBeCloseTo(139.75, 1);
  });

  it("首都の区分が複数ある国は、人口の最も多い首都（ボリビアはラパス）", () => {
    const laPaz = PLACES.find((p) => p.key === "BO" && p.name === "La Paz");
    expect(index.capitalOf("BO")).toEqual({ latitude: laPaz?.latitude, longitude: laPaz?.longitude });
  });

  it("区分 0 が無い国は、区分 1（地域の首都）を使う（香港）", () => {
    const hk = PLACES.find((p) => p.key === "HK" && p.capitalTier === 1);
    expect(index.capitalOf("HK")).toEqual({ latitude: hk?.latitude, longitude: hk?.longitude });
  });

  it("首都の区分が無い国（プエルトリコ）は undefined", () => {
    expect(index.capitalOf("PR")).toBeUndefined();
  });

  it("不明な国は undefined（例外にしない）", () => {
    expect(index.capitalOf("XX")).toBeUndefined();
  });
});

describe("都市", () => {
  it("同名の都市は人口の多い方（コロンバスはオハイオ）", () => {
    const ohio = PLACES.find((p) => p.key === "US" && p.name === "Columbus" && p.population === 1270000);
    expect(index.cityOf("US", "Columbus")).toEqual({ latitude: ohio?.latitude, longitude: ohio?.longitude });
  });

  it("英語名でも一致する（コペンハーゲン → København）", () => {
    expect(index.cityOf("DK", "Copenhagen")).toBeDefined();
  });

  it("アクセントや大文字小文字を無視して一致する（Bogota → Bogotá）", () => {
    expect(index.cityOf("CO", "Bogota")).toBeDefined();
  });

  it("データに無い都市は undefined（例: Ashburn）", () => {
    expect(index.cityOf("US", "Ashburn")).toBeUndefined();
  });

  it("国コードが違えば一致しない", () => {
    expect(index.cityOf("FR", "London")).toBeUndefined();
  });
});

describe("国の選択肢と存在", () => {
  it("首都が引ける国だけを選択肢にし、日本の名前を付ける", () => {
    const options = index.countryOptions();
    expect(options.find((o) => o.code === "JP")?.name).toBe("日本");
    expect(options.some((o) => o.code === "PR")).toBe(false);
  });

  it("コソボ（KOS）は国の選択肢に含め、日本語の名前を付ける", () => {
    expect(index.countryOptions().find((o) => o.code === "KOS")?.name).toBe("コソボ");
  });

  it("hasCountry は首都の有無で判定する", () => {
    expect(index.hasCountry("JP")).toBe(true);
    expect(index.hasCountry("PR")).toBe(false);
  });

  it("getGeoIndex は同梱データから作った単一のインスタンスを返す", () => {
    expect(getGeoIndex()).toBe(getGeoIndex());
  });
});
