// 責務: 配色の変数（トークン）の検査。色の直接指定が変数の定義の外に残っていないこと、
// ライトとダークの両方に同じトークンが定められていることを、スタイルの文字列から確かめる。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "../styles.css"), "utf8");

// コメントは色の説明に現れるため、検査の前に取り除く。
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

// 変数の定義ブロック（:root と :root[data-theme="dark"]）だけを集め、それ以外を「規則」とみなす。
const BLOCK_PATTERN = /(:root(?:\[data-theme="dark"\])?)\s*\{([^}]*)\}/g;
const lightBlock = [...withoutComments.matchAll(BLOCK_PATTERN)].find((m) => m[1] === ":root")?.[2] ?? "";
const darkBlock = [...withoutComments.matchAll(BLOCK_PATTERN)].find((m) => m[1] === ':root[data-theme="dark"]')?.[2] ?? "";
const rulesOutsideTokens = withoutComments.replace(BLOCK_PATTERN, "");

const REQUIRED_TOKENS = [
  "--page-bg",
  "--surface",
  "--surface-hover",
  "--tint",
  "--text",
  "--text-on-accent",
  "--accent",
  "--border",
  "--input-border",
  "--muted",
  "--muted-bg",
  "--ok",
  "--ok-bg",
  "--warn",
  "--warn-bg",
  "--danger",
  "--danger-bg",
  "--star-active",
  "--scroll-thumb",
  "--scroll-thumb-active",
  "--overlay",
  "--shadow",
];

describe("配色のトークン", () => {
  it("変数の定義の外に、色の直接指定（#xxx・rgb・rgba）が残っていない", () => {
    expect(rulesOutsideTokens.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []).toEqual([]);
  });

  it.each(REQUIRED_TOKENS)("%s はライトとダークの両方に定められている", (token) => {
    expect(lightBlock).toContain(`${token}:`);
    expect(darkBlock).toContain(`${token}:`);
  });

  it("ダークは color-scheme を dark にし、フォーム部品とスクロールバーを揃える", () => {
    expect(darkBlock).toContain("color-scheme: dark");
  });

  it("OS の配色を CSS の @media で扱わない（JS で解決した data-theme だけを使う）", () => {
    expect(withoutComments).not.toContain("prefers-color-scheme");
  });
});
