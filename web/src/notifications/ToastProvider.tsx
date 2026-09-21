// 責務: 画面右上に積み重なる通知（トースト）の状態管理と表示。エラーは要約を通常表示し、詳細（stderr等）は
// 折りたたみ（<details>）に入れる。成功通知は一定時間で自動的に消え、エラーは利用者が閉じるまで残す
// （読み終える前に消えると原因を確認できないため）。

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ErrorContent } from "./describe-api-error";

interface Toast {
  id: number;
  kind: "error" | "success";
  summary: string;
  detail?: string;
}

interface ToastApi {
  notifyError: (content: ErrorContent) => void;
  notifySuccess: (summary: string) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

const SUCCESS_TOAST_MS = 4000;
// 同時表示の上限。エラーが連続しても画面を埋め尽くさないよう古いものから捨てる。
const MAX_TOASTS = 5;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...toast, id }].slice(-MAX_TOASTS));
      if (toast.kind === "success") {
        setTimeout(() => dismiss(id), SUCCESS_TOAST_MS);
      }
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      notifyError: (content) => push({ kind: "error", ...content }),
      notifySuccess: (summary) => push({ kind: "success", summary }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" aria-label="通知">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
            <div className="toast-body">
              <span>{toast.summary}</span>
              {toast.detail ? (
                <details>
                  <summary>詳細</summary>
                  <pre>{toast.detail}</pre>
                </details>
              ) : null}
            </div>
            <button type="button" className="toast-close" aria-label="通知を閉じる" onClick={() => dismiss(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * 目的: ToastProvider配下のコンポーネントから通知APIを取得する。
 * 出力: notifyError/notifySuccess。ToastProvider外で呼ぶと例外（実装ミスを早期に検出するため）。
 * 例: const { notifyError } = useToast(); notifyError({ summary: "失敗しました" });
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return api;
}
