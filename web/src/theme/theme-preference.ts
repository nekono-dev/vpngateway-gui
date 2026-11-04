// 責務: テーマ（OS 規定・ライト・ダーク）の循環・解決・表示名・theme-color の値を定める純粋な処理。
// DOM や通信を扱わず、判定だけを行う（テストを単純にするため）。

/** 利用者が選ぶ値。api の保存値と同じ3種類。 */
export type ThemePreference = "system" | "light" | "dark";

/** 画面に実際に適用するテーマ。 */
export type ResolvedTheme = "light" | "dark";

const NEXT_PREFERENCE: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

/**
 * 目的: 切り替えボタンを押したときの次のテーマを返す（OS 規定 → ライト → ダーク → OS 規定）。
 * 入力: current（現在の選択）。
 * 出力: 次の選択。
 */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  return NEXT_PREFERENCE[current];
}

/**
 * 目的: 選択と OS の配色から、画面に適用するテーマを決める。
 * 入力: preference（選択）、prefersDark（OS の配色がダークかどうか）。
 * 出力: 適用するテーマ。OS 規定のときだけ prefersDark を使う。
 */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === "system") {
    return prefersDark ? "dark" : "light";
  }
  return preference;
}

/** 切り替えボタンに表示する名前。 */
export const THEME_LABEL: Record<ThemePreference, string> = {
  system: "OS 規定",
  light: "ライト",
  dark: "ダーク",
};

/**
 * ブラウザへ伝える表示色（meta の theme-color）。
 * ライトは従来の値を保つ。ダークは設計で定めた初期値で、実装時の画面確認で見直す。
 */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: "#0969da",
  dark: "#0d1117",
};
