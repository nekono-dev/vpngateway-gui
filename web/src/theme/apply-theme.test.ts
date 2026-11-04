// 責務: 解決後のテーマを html の data-theme と meta の theme-color に反映する処理の単体テスト。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyResolvedTheme } from "./apply-theme";

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = '<meta name="theme-color" content="#0969da" />';
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = "";
});

describe("applyResolvedTheme", () => {
  it("ダークに解決すると、html の data-theme と theme-color をダーク用の値にする", () => {
    applyResolvedTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#0d1117");
  });

  it("ライトに解決すると、data-theme と theme-color をライト用の値に戻す", () => {
    applyResolvedTheme("dark");
    applyResolvedTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#0969da");
  });

  it("theme-color の要素が無くても例外にならず、data-theme だけを書く", () => {
    document.head.innerHTML = "";
    expect(() => applyResolvedTheme("dark")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
