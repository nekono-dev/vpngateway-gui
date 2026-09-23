// 責務: Web UI利用者の認証状態（未設定／未ログイン／ログイン済み）の判定・保持と、
// ログイン画面への強制遷移。webserver/design.md「利用者認証の実装方針」参照。
// API呼び出しは生成クライアント以外を使わない。

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { deleteV1OperatorSession, getV1Operator, getV1OperatorSession } from "../generated/api/default/default";

export type AuthState =
  | { status: "loading" }
  | { status: "setup" }
  | { status: "login" }
  | { status: "authenticated"; username: string };

interface AuthContextValue {
  auth: AuthState;
  /** 初期設定・ログインの成功時に呼ぶ。ダッシュボードへ遷移する。 */
  setAuthenticated: (username: string) => void;
  /** DELETE /v1/operator/sessionを実行し、ログイン画面へ戻る。 */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ログイン済みの間、この間隔でセッションの有効性を確認する。以後のいずれかのAPI呼び出しが401を返した場合も
// ログイン画面へ切り替えるという方針（webserver/design.md）を、個々の呼び出し箇所ごとに実装する代わりに、
// ダッシュボードのポーリング間隔（5秒、hooks/useDashboardPolling.ts）に合わせたこの定期確認でまかなう。
const SESSION_CHECK_INTERVAL_MS = 5000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const operator = await getV1Operator();
      if (cancelled) return;
      if (!operator.data.configured) {
        setAuth({ status: "setup" });
        return;
      }
      // GET /v1/operatorは有効なセッションCookieがある場合のみusernameを含める。
      if (operator.data.username !== undefined) {
        setAuth({ status: "authenticated", username: operator.data.username });
        return;
      }
      setAuth({ status: "login" });
    })().catch(() => {
      if (!cancelled) {
        setAuth({ status: "login" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (auth.status !== "authenticated") {
      return;
    }
    let cancelled = false;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      getV1OperatorSession()
        .then((response) => {
          if (!cancelled && response.status === 401) {
            setAuth({ status: "login" });
          }
        })
        .catch(() => {
          // 一時的な通信失敗ではログイン画面へ切り替えない（プロキシ障害時の他表示と同様、次回の確認に委ねる）。
        });
    }, SESSION_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [auth.status]);

  const value: AuthContextValue = {
    auth,
    setAuthenticated: (username) => setAuth({ status: "authenticated", username }),
    async logout() {
      await deleteV1OperatorSession();
      setAuth({ status: "login" });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * 目的: 認証状態・遷移関数を取得する。AuthProviderの外で呼ぶとエラーになる。
 * 出力: AuthContextValue。
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
