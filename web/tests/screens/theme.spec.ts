// 責務: 3通りのテーマ（OS 規定・ライト・ダーク）・切り替えボタン・OS 配色への追従・本文のコントラストの画面確認。
// 対象: タスク 7.2（要件 1.1・1.2・1.3・1.4・3.1・5.1・5.4）。取得の空白・失敗・保存失敗は theme-states.spec.ts。

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { mockApi, type ThemeValue } from "./mock-api";

// スクリーンショットは e2e/artifacts/screens に残す（リポジトリ直下。Git の対象外）。
const SCREENS_DIR = fileURLToPath(new URL("../../../e2e/artifacts/screens/", import.meta.url));
mkdirSync(SCREENS_DIR, { recursive: true });

const appliedTheme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

/**
 * 目的: 表示されている本文の文字（直接の文字を持つ要素）について、文字色と背景色のコントラスト比の最小値を求める。
 * 入力: page（確認する画面）。
 * 出力: 最小のコントラスト比と、その要素の文字・色（最も低いもの）。無効（disabled）の操作部品は対象外（WCAG の例外）。
 * 理由: 背景は、文字の要素から祖先をたどって最初に不透明になる背景色を使う（変数で決まる実際の描画色）。
 */
async function lowestContrast(page: Page): Promise<{ ratio: number; text: string; color: string; background: string }> {
  return page.evaluate(() => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return { r: 255, g: 255, b: 255, a: 1 };
      const parts = match[1].split(",").map((part) => parseFloat(part));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (value: number) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const backgroundOf = (element: Element) => {
      let current: Element | null = element;
      while (current) {
        const color = parse(getComputedStyle(current).backgroundColor);
        if (color.a > 0) return color;
        current = current.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    let lowest = { ratio: Infinity, text: "", color: "", background: "" };
    for (const element of Array.from(document.querySelectorAll("body *"))) {
      const hasOwnText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0,
      );
      if (!hasOwnText || element.getClientRects().length === 0) continue;
      if (element.matches(":disabled, :disabled *")) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const foreground = parse(style.color);
      const background = backgroundOf(element);
      const l1 = luminance(foreground);
      const l2 = luminance(background);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (ratio < lowest.ratio) {
        lowest = {
          ratio,
          text: (element.textContent ?? "").trim().slice(0, 40),
          color: style.color,
          background: `rgb(${background.r}, ${background.g}, ${background.b})`,
        };
      }
    }
    return lowest;
  });
}

test.describe("初期設定・ログイン画面（未ログイン）", () => {
  test("保存済みのダークが、ログイン前の画面にも反映される（3.1）", async ({ page }) => {
    await mockApi(page, { configured: true, loggedIn: false, theme: "dark" });
    await page.goto("/");
    await expect(page.locator("form").first()).toBeVisible();
    expect(await appliedTheme(page)).toBe("dark");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(13, 17, 23)");
    await page.screenshot({ path: `${SCREENS_DIR}/login-dark.png`, fullPage: true });
    const contrast = await lowestContrast(page);
    expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
  });

  test("初期設定の画面にも、保存済みのテーマが反映される（3.1）", async ({ page }) => {
    await mockApi(page, { configured: false, theme: "dark" });
    await page.goto("/");
    await expect(page.locator("form").first()).toBeVisible();
    expect(await appliedTheme(page)).toBe("dark");
    await page.screenshot({ path: `${SCREENS_DIR}/setup-dark.png`, fullPage: true });
  });
});

test.describe("ダッシュボードの3通りのテーマ（保存値と OS の配色の組み合わせ）", () => {
  const cases: { saved: ThemeValue; os: "light" | "dark"; expected: "light" | "dark" }[] = [
    { saved: "system", os: "light", expected: "light" },
    { saved: "system", os: "dark", expected: "dark" },
    { saved: "light", os: "dark", expected: "light" },
    { saved: "dark", os: "light", expected: "dark" },
  ];

  for (const { saved, os, expected } of cases) {
    test(`保存値 ${saved}・OS ${os} で ${expected} が適用される（1.2・1.3）`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: os });
      await mockApi(page, { loggedIn: true, theme: saved });
      await page.goto("/");
      await expect(page.locator("header.app-header h1")).toBeVisible();
      expect(await appliedTheme(page)).toBe(expected);
      await page.screenshot({ path: `${SCREENS_DIR}/dashboard-${saved}-os-${os}.png`, fullPage: true });
    });
  }
});

test("切り替えボタンは「OS 規定 → ライト → ダーク」を循環し、押した直後に反映され、保存される（1.1・1.2・2.1）", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  const state = await mockApi(page, { loggedIn: true, theme: "system" });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "テーマ: OS 規定" });
  await expect(toggle).toBeVisible();

  await toggle.click();
  await expect(page.getByRole("button", { name: "テーマ: ライト" })).toBeVisible();
  expect(await appliedTheme(page)).toBe("light");

  await page.getByRole("button", { name: "テーマ: ライト" }).click();
  await expect(page.getByRole("button", { name: "テーマ: ダーク" })).toBeVisible();
  expect(await appliedTheme(page)).toBe("dark");

  await page.getByRole("button", { name: "テーマ: ダーク" }).click();
  await expect(page.getByRole("button", { name: "テーマ: OS 規定" })).toBeVisible();
  expect(await appliedTheme(page)).toBe("light");

  expect(state.savedThemes).toEqual(["light", "dark", "system"]);
});

test("OS 規定のとき、OS の配色が変わると再読み込みなしで表示が変わる（1.4）", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mockApi(page, { loggedIn: true, theme: "system" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  // 再読み込みが起きていないことを、ページ上の印で確かめる。
  await page.evaluate(() => {
    (window as unknown as { marker: string }).marker = "kept";
  });

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => (window as unknown as { marker?: string }).marker)).toBe("kept");
});

test.describe("本文のコントラスト（5.1）", () => {
  test("ライトのダッシュボードで、本文の文字と背景のコントラスト比が 4.5:1 以上", async ({ page }) => {
    await mockApi(page, { loggedIn: true, theme: "light" });
    await page.goto("/");
    await expect(page.locator("header.app-header h1")).toBeVisible();
    const contrast = await lowestContrast(page);
    expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
  });

  test("ダークのダッシュボードで、本文の文字と背景のコントラスト比が 4.5:1 以上", async ({ page }) => {
    await mockApi(page, { loggedIn: true, theme: "dark" });
    await page.goto("/");
    await expect(page.locator("header.app-header h1")).toBeVisible();
    await page.screenshot({ path: `${SCREENS_DIR}/dashboard-dark-contrast.png`, fullPage: true });
    const contrast = await lowestContrast(page);
    expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
  });
});

test("OS 規定のとき、OS の配色が変わると theme-color も追従する（6.2）", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mockApi(page, { loggedIn: true, theme: "system" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const themeColor = () => page.locator('meta[name="theme-color"]').getAttribute("content");
  expect(await themeColor()).toBe("#0969da");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await themeColor()).toBe("#0d1117");
});

test.describe("ダイアログもダークの配色で表示され、本文のコントラストを満たす（5.4・5.1）", () => {
  for (const { button, name } of [
    { button: "設定", name: "settings" },
    { button: "接続ログ", name: "connection-log" },
  ]) {
    test(`${name} ダイアログ（ダーク）`, async ({ page }) => {
      await mockApi(page, { loggedIn: true, theme: "dark" });
      await page.goto("/");
      await expect(page.locator("header.app-header h1")).toBeVisible();
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(page.locator("dialog[open]").first()).toBeVisible();
      await page.screenshot({ path: `${SCREENS_DIR}/dialog-${name}-dark.png`, fullPage: true });
      const contrast = await lowestContrast(page);
      expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe("テーマの切り替えボタン（アイコンのみ）は共通のボタン規格に従う", () => {
  const cases = [
    { os: "light" as const, saved: "light" as const, text: "rgb(31, 35, 40)", border: "rgb(208, 215, 222)" },
    { os: "light" as const, saved: "dark" as const, text: "rgb(230, 237, 243)", border: "rgb(48, 54, 61)" },
  ];
  for (const { os, saved, text, border } of cases) {
    test(`保存値 ${saved}: 文字色（アイコンの線）は本文の色 ${text}、枠線は共通の枠線色、背景は面の色`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: os });
      await mockApi(page, { loggedIn: true, theme: saved });
      await page.goto("/");
      const toggle = page.locator("button.theme-toggle");
      await expect(toggle).toBeVisible();
      const styles = await toggle.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          color: style.color,
          border: style.borderTopColor,
          background: style.backgroundColor,
          svgStroke: getComputedStyle(element.querySelector("svg") as Element).stroke,
        };
      });
      // 他の既定のボタンと同じ規格: 文字色は本文の色、枠線は共通の枠線色、背景は面の色。アイコンの線は文字色に従う。
      expect(styles.color).toBe(text);
      expect(styles.svgStroke).toBe(text);
      expect(styles.border).toBe(border);
      await toggle.screenshot({ path: `${SCREENS_DIR}/theme-toggle-${saved}.png` });
    });
  }

  test("ホバーで枠線がアクセント色になる（共通のボタン規格）", async ({ page }) => {
    await mockApi(page, { loggedIn: true, theme: "light" });
    await page.goto("/");
    const toggle = page.locator("button.theme-toggle");
    await toggle.hover();
    const border = await toggle.evaluate((element) => getComputedStyle(element).borderTopColor);
    expect(border).toBe("rgb(9, 105, 218)");
  });
});
