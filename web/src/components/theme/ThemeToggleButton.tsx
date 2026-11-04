// 責務: テーマの切り替えボタン。現在の選択を「テーマ: 表示名」で示し、押すたびに次のテーマへ循環する。
// 保存中は押せない（連続の保存を防ぐ）。状態と保存は ThemeContext が持つ。

import { useTheme } from "../../contexts/ThemeContext";
import { nextThemePreference, THEME_LABEL } from "../../theme/theme-preference";

export function ThemeToggleButton() {
  const { preference, saving, setPreference } = useTheme();
  const label = `テーマ: ${THEME_LABEL[preference]}`;
  return (
    <button
      type="button"
      aria-label={label}
      disabled={saving}
      onClick={() => void setPreference(nextThemePreference(preference))}
    >
      {label}
    </button>
  );
}
