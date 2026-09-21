// 責務: slugify（分音記号除去・記号のハイフン化・フォールバック）の単体テスト。

import { describe, expect, it } from "vitest";
import { slugify } from "./slugify.js";

describe("slugify", () => {
  it("小文字化し、空白をハイフンにする", () => {
    expect(slugify("Las Vegas", "x")).toBe("las-vegas");
  });

  it("分音記号を除去する（São Paulo / Chișinău）", () => {
    expect(slugify("São Paulo", "x")).toBe("sao-paulo");
    expect(slugify("Chișinău", "x")).toBe("chisinau");
  });

  it("記号の連続を1つのハイフンにし、前後のハイフンを除く", () => {
    expect(slugify("Shanghai (Virtual)", "x")).toBe("shanghai-virtual");
    expect(slugify("  -St. Louis- ", "x")).toBe("st-louis");
  });

  it("英数字が残らない場合はfallbackを返す", () => {
    expect(slugify("東京", "location")).toBe("location");
    expect(slugify("", "location")).toBe("location");
  });
});
