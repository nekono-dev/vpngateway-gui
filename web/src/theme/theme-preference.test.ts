// 責務: テーマの循環・解決・表示名・theme-color の値の単体テスト。

import { describe, expect, it } from "vitest";
import { nextThemePreference, resolveTheme, THEME_COLOR, THEME_LABEL } from "./theme-preference";

describe("nextThemePreference", () => {
  it("OS 規定 → ライト → ダーク → OS 規定 の順に循環する", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("OS 規定は、OS がダークならダーク、そうでなければライトに解決する", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("ライトとダークは、OS の配色によらず固定の値になる", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("表示名と theme-color", () => {
  it("表示名は3種類それぞれに定められている", () => {
    expect(THEME_LABEL).toEqual({ system: "OS 規定", light: "ライト", dark: "ダーク" });
  });

  it("theme-color のライトは現行の値（#0969da）を保つ。ダークは定めた値を使う", () => {
    expect(THEME_COLOR.light).toBe("#0969da");
    expect(THEME_COLOR.dark).toBe("#0d1117");
  });
});
