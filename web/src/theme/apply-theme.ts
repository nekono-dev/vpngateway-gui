// 責務: 解決後のテーマを、html の data-theme 属性と meta の theme-color へ反映する（DOM への書き込みのみ）。
// 配色そのものは styles.css のトークンが決め、color-scheme も同じ属性で切り替える。

import { THEME_COLOR, type ResolvedTheme } from "./theme-preference";

/**
 * 目的: 解決後のテーマを画面に適用する。
 * 入力: resolved（適用するテーマ。light または dark）。
 * 出力: なし。
 * 副作用: `<html>` の data-theme を書き換え、`meta[name="theme-color"]` があれば content を書き換える。
 *        meta が無い場合は何もしない（index.html には既存の meta がある）。
 */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = THEME_COLOR[resolved];
  }
}
