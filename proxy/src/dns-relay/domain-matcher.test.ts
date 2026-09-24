// 責務: 迂回ドメインの表記検証・照合（domain-matcher.ts）の単体テスト。

import { describe, expect, it } from "vitest";
import { createDomainMatcher, isValidDomainPattern, normalizeDomain } from "./domain-matcher.js";

describe("isValidDomainPattern", () => {
  it.each(["example.com", "*.example.com", "a-b.example.co.jp", "EXAMPLE.com.", "1.example.com"])("妥当: %s", (value) => {
    expect(isValidDomainPattern(value)).toBe(true);
  });

  it.each([
    "",
    "localhost",
    "*",
    "*.com.*",
    "a*.example.com",
    "example.com/path",
    "exa mple.com",
    "-a.example.com",
    "a-.example.com",
    "example..com",
    "*.",
    `${"a".repeat(64)}.com`,
    `${"a.".repeat(130)}com`,
    "example.com\nallow",
  ])("不正: %j", (value) => {
    expect(isValidDomainPattern(value)).toBe(false);
  });
});

describe("createDomainMatcher", () => {
  it("完全一致の表記は、そのドメイン自身のみに一致しサブドメインには一致しない", () => {
    const match = createDomainMatcher(["example.com"]);
    expect(match("example.com")).toBe(true);
    expect(match("EXAMPLE.com.")).toBe(true);
    expect(match("www.example.com")).toBe(false);
    expect(match("notexample.com")).toBe(false);
  });

  it("ワイルドカードの表記は、複数階層を含むサブドメインのみに一致しapexには一致しない", () => {
    const match = createDomainMatcher(["*.example.com"]);
    expect(match("www.example.com")).toBe(true);
    expect(match("a.b.example.com")).toBe(true);
    expect(match("example.com")).toBe(false);
    expect(match("badexample.com")).toBe(false);
  });

  it("両方を登録すればapexとサブドメインの両方に一致する", () => {
    const match = createDomainMatcher(["example.com", "*.example.com"]);
    expect(match("example.com")).toBe(true);
    expect(match("x.example.com")).toBe(true);
  });

  it("不正な表記は無視する。空の一覧は何にも一致しない", () => {
    expect(createDomainMatcher(["bad domain"])("bad domain")).toBe(false);
    expect(createDomainMatcher([])("example.com")).toBe(false);
  });
});

describe("normalizeDomain", () => {
  it("小文字化し末尾のドットを取る", () => {
    expect(normalizeDomain("WWW.Example.COM.")).toBe("www.example.com");
  });
});
