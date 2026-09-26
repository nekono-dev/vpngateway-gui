// 責務: 設定の動作検証の状態アイコン（待機中: 中空の円 / 実行中: 円形に並んだ8つの点が順に光る / OK: 緑の円にチェック /
// NG: 赤の円に× / 未確認: 中空の円に横線）。色はstyles.cssの`.verify-icon-*`で与える。

import type { DisplayState } from "./verification-view";

const SPINNER_DOTS = Array.from({ length: 8 }, (_, index) => {
  const angle = (index * Math.PI) / 4;
  return { index, cx: 12 + 8.5 * Math.sin(angle), cy: 12 - 8.5 * Math.cos(angle) };
});

export function StatusIcon({ state }: { state: DisplayState }) {
  return (
    <svg className={`verify-icon verify-icon-${state}`} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      {state === "wait" ? <circle cx="12" cy="12" r="8.5" fill="none" strokeWidth="2" /> : null}
      {state === "pass" ? (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M7 12.5l3.2 3.2L17 8.8" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
      {state === "fail" ? (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" strokeWidth="2.2" strokeLinecap="round" />
        </>
      ) : null}
      {state === "unconfirmed" ? (
        <>
          <circle cx="12" cy="12" r="8.5" fill="none" strokeWidth="2" />
          <path d="M8.5 12h7" strokeWidth="2.2" strokeLinecap="round" />
        </>
      ) : null}
      {state === "running"
        ? SPINNER_DOTS.map((dot) => (
            <circle key={dot.index} cx={dot.cx.toFixed(2)} cy={dot.cy.toFixed(2)} r="2" style={{ animationDelay: `${dot.index * 0.1 - 0.8}s` }} />
          ))
        : null}
    </svg>
  );
}
