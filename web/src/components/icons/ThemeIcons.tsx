// 責務: テーマ切り替えボタン用のアイコン（OS 規定＝ノートPC、ライト＝太陽、ダーク＝三日月）のインラインSVG表示のみを行う。
// 線の色は currentColor で、ボタンの文字色（テーマのアクセント色）に従う。

interface ThemeIconProps {
  /** テストと確認用の識別子（どのテーマのアイコンかを示す）。 */
  icon: "system" | "light" | "dark";
}

const COMMON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function ThemeIcon({ icon }: ThemeIconProps) {
  if (icon === "system") {
    return (
      <svg {...COMMON} data-icon="system">
        <rect x="4" y="4" width="16" height="12" rx="2" />
        <path d="M2 20h20" />
      </svg>
    );
  }
  if (icon === "light") {
    return (
      <svg {...COMMON} data-icon="light">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  }
  return (
    <svg {...COMMON} data-icon="dark">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
