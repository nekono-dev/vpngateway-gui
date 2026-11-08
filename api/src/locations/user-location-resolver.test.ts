// 責務: 利用者の国の決定（保存された値 → ブラウザの言語設定の地域 → 無し）と、Accept-Language の解析を確かめる。
import { describe, expect, it } from "vitest";
import { parseAcceptLanguageRegions, resolveUserLocation } from "./user-location-resolver.js";

const KNOWN = new Set(["JP", "US", "GB", "BO", "KOS"]);
const isKnown = (code: string) => KNOWN.has(code);

describe("parseAcceptLanguageRegions", () => {
  it("ja-JP から地域 JP を取り出す", () => {
    expect(parseAcceptLanguageRegions("ja-JP")).toEqual(["JP"]);
  });

  it("品質値では並べ替えず、ヘッダの順に読む", () => {
    expect(parseAcceptLanguageRegions("en;q=0.8, ja-JP;q=0.9")).toEqual(["JP"]);
    expect(parseAcceptLanguageRegions("en-US;q=0.5, ja-JP;q=0.9")).toEqual(["US", "JP"]);
  });

  it("文字種のサブタグ（Hant）を飛ばして地域 TW を取り出す", () => {
    expect(parseAcceptLanguageRegions("zh-Hant-TW")).toEqual(["TW"]);
  });

  it("数字の地域（es-419）は対象外、地域の無い言語（en）も対象外", () => {
    expect(parseAcceptLanguageRegions("es-419, en")).toEqual([]);
  });

  it("ヘッダが無い・* のときは空", () => {
    expect(parseAcceptLanguageRegions(undefined)).toEqual([]);
    expect(parseAcceptLanguageRegions("*")).toEqual([]);
  });
});

describe("resolveUserLocation", () => {
  it("保存された国が既知なら、それを使う（saved）", () => {
    expect(resolveUserLocation({ saved: "US", acceptLanguage: "ja-JP", isKnownCountry: isKnown })).toEqual({ country: "US", source: "saved" });
  });

  it("保存が無ければ、ヘッダの最初の既知の国を使う（browser）", () => {
    expect(resolveUserLocation({ saved: undefined, acceptLanguage: "xx-YY, ja-JP", isKnownCountry: isKnown })).toEqual({ country: "JP", source: "browser" });
  });

  it("保存が未知の国なら、ヘッダへ戻る", () => {
    expect(resolveUserLocation({ saved: "XX", acceptLanguage: "BO-ignored, ja-JP", isKnownCountry: isKnown })).toEqual({ country: "JP", source: "browser" });
  });

  it("保存も既知の地域も無ければ決まらない（none）", () => {
    expect(resolveUserLocation({ saved: undefined, acceptLanguage: "en", isKnownCountry: isKnown })).toEqual({ country: undefined, source: "none" });
  });
});
