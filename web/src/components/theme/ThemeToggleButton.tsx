// 責務: テーマの切り替えボタン。現在の選択をアイコンで示し（文字は出さず、表示名は title と aria-label に持つ）、
// 押すたびに「OS 規定 → ライト → ダーク」へ循環する。保存中は押せない（連続の保存を防ぐ）。状態と保存は ThemeContext が持つ。

import { useTheme } from "../../contexts/ThemeContext";
import { ThemeIcon } from "../icons/ThemeIcons";
import { nextThemePreference, THEME_LABEL } from "../../theme/theme-preference";

export function ThemeToggleButton() {
  const { preference, saving, setPreference } = useTheme();
  const label = `テーマ: ${THEME_LABEL[preference]}`;
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={label}
      title={label}
      disabled={saving}
      onClick={() => void setPreference(nextThemePreference(preference))}
    >
      <ThemeIcon icon={preference} />
    </button>
  );
}
