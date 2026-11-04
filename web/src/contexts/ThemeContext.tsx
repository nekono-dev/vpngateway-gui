// 責務: テーマ（OS 規定・ライト・ダーク）の取得・保存・OS 配色への追従を保持し、取得が終わるまで画面を描画しない。
// API 呼び出しは生成クライアント以外を使わない。判定は theme/theme-preference、適用は theme/apply-theme に任せる。

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getV1UiPreferences, putV1UiPreferences } from "../generated/api/default/default";
import { useToast } from "../notifications/ToastProvider";
import { describeApiError, describeThrownError } from "../notifications/describe-api-error";
import { applyResolvedTheme } from "../theme/apply-theme";
import { resolveTheme, type ResolvedTheme, type ThemePreference } from "../theme/theme-preference";

export interface ThemeContextValue {
  /** 利用者が選んでいるテーマ（OS 規定・ライト・ダーク）。 */
  preference: ThemePreference;
  /** 画面に実際に適用しているテーマ（OS 規定のときは OS の配色で決まる）。 */
  resolved: ResolvedTheme;
  /** 保存の要求が送信中かどうか（送信中は切り替えを受け付けない）。 */
  saving: boolean;
  /** 指定のテーマへ即時に切り替えて保存する。保存に失敗したら切り替え前へ戻し、通知する。 */
  setPreference: (next: ThemePreference) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];
const DARK_QUERY = "(prefers-color-scheme: dark)";
const SAVE_FAILED = "テーマの保存に失敗しました";

/**
 * 目的: 応答の値が3種類のテーマのいずれかかを判定する。
 * 入力: value（応答から取り出した値。unknown）。
 * 出力: 3種類のいずれかなら true。
 */
function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (PREFERENCES as readonly string[]).includes(value);
}

/**
 * 目的: テーマを取得し、取得が終わるまで子要素を描画しない。OS の配色の変化にも追従する。
 * 入力: children（テーマが決まってから描画する子要素）。
 * 出力: 取得中は null（空白）。取得後は子要素。
 * 失敗時の方針: 取得に失敗した、または応答が不正なときは「OS 規定」として描画を続ける（テーマは補助的な表示のため）。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { notifyError } = useToast();
  const [preference, setStoredPreference] = useState<ThemePreference | undefined>(undefined);
  const [prefersDark, setPrefersDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches,
  );
  const [saving, setSaving] = useState(false);
  // 連続の切り替えを防ぐため、送信中の判定は state ではなく ref で行う（同じ描画の中の二度押しにも効かせる）。
  const savingRef = useRef(false);

  // 起動時の取得。適用を先に済ませてから状態を変えるため、子要素は正しいテーマで最初に描画される（4.3）。
  useEffect(() => {
    let cancelled = false;
    const finish = (theme: ThemePreference) => {
      if (cancelled) return;
      applyResolvedTheme(resolveTheme(theme, window.matchMedia(DARK_QUERY).matches));
      setStoredPreference(theme);
    };
    getV1UiPreferences()
      .then((response) => {
        finish(response.status === 200 && isThemePreference(response.data.theme) ? response.data.theme : "system");
      })
      .catch(() => finish("system"));
    return () => {
      cancelled = true;
    };
  }, []);

  // OS の配色の変化に追従する（OS 規定のときだけ表示に影響する）。
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: { matches: boolean }) => setPrefersDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolved = preference === undefined ? undefined : resolveTheme(preference, prefersDark);

  // 解決後のテーマを画面へ反映する（OS の配色の変化や切り替えのたびに更新する）。
  useEffect(() => {
    if (resolved !== undefined) {
      applyResolvedTheme(resolved);
    }
  }, [resolved]);

  // 即時に切り替えて保存する。応答が来たらサーバの値で確定し、失敗したら切り替え前へ戻して通知する。
  const setPreferenceAndSave = async (next: ThemePreference): Promise<void> => {
    if (savingRef.current || preference === undefined) return;
    const previous = preference;
    savingRef.current = true;
    setSaving(true);
    setStoredPreference(next);
    try {
      const response = await putV1UiPreferences({ theme: next });
      if (response.status === 200 && isThemePreference(response.data.theme)) {
        setStoredPreference(response.data.theme);
      } else {
        setStoredPreference(previous);
        notifyError(describeApiError(response.status, response.data, SAVE_FAILED));
      }
    } catch (error) {
      setStoredPreference(previous);
      notifyError(describeThrownError(error, SAVE_FAILED));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (preference === undefined || resolved === undefined) {
    return null;
  }

  return (
    <ThemeContext.Provider value={{ preference, resolved, saving, setPreference: setPreferenceAndSave }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * 目的: テーマの状態を取得する。ThemeProvider の外で呼ぶと例外になる（useAuth と同じ作法）。
 * 出力: ThemeContextValue。
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
