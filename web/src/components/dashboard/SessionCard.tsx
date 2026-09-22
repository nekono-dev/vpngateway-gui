// 責務: VPNプロバイダのログイン状態（ログイン済み・プラン名・未ログイン）の表示、ログイン導線
// （`loginMethod`で切替: URL提示型のボタン／ユーザー名・パスワード入力型のフォーム）、ログアウトの組み立てのみを行う。
// ログイン完了後の状態反映は、ダッシュボードの状態ポーリング（useDashboardPolling）を即時再取得させて行う
// （従来の`VpnLoginButton`を置換。webserver/design.md「コンポーネントと責務」）。
// 【Phase 16】接続・切断ボタンは押しやすい位置に置くため、親（App）から渡された部品をアカウント状態表示の隣に
// 表示するだけで、接続・切断そのものの組み立てはここでは行わない
// （webserver/requirements.md「切断ボタンの配置・強調」「接続ボタンの配置」）。
import { type ReactNode, useState } from "react";
import type { CapabilitiesState, SessionState } from "../../hooks/useDashboardPolling";
import { deleteV1Session, postV1Session } from "../../generated/api/default/default";
import { isAvailable, reasonOf } from "../../capabilities/capability-state";
import { describeApiError, describeThrownError } from "../../notifications/describe-api-error";
import { useToast } from "../../notifications/ToastProvider";
import { LoginForm } from "./LoginForm";
import { RestrictionNote } from "./RestrictionNote";

interface Props {
  // ログイン方式・ログイン状態・プラン。取得できていなければundefined（従来どおりログイン導線を出す）。
  session: SessionState | undefined;
  capabilities: CapabilitiesState | undefined;
  // ログイン・ログアウトの成功後に状態を再取得する。
  onChanged: () => void;
  // 接続中のみ親から渡される切断ボタン（DisconnectButton）。アカウント状態表示の隣に表示する。
  disconnectAction?: ReactNode;
  // 切断中のみ親から渡される接続ボタン（ConnectButton）。アカウント状態表示の隣に表示する。
  connectAction?: ReactNode;
}

export function SessionCard({ session, capabilities, onChanged, disconnectAction, connectAction }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // URL提示型のログインで返されたURL・メッセージ。
  const [result, setResult] = useState<{ loginUrl?: string; message: string }>();
  const { notifyError, notifySuccess } = useToast();
  const loginMethod = session?.loginMethod ?? "deviceUrl";
  const loggedIn = session?.loggedIn;
  const canLogin = isAvailable(capabilities, "login");
  const canLogout = isAvailable(capabilities, "logout");
  const logoutReason = reasonOf(capabilities, "logout");

  /**
   * 目的: ログインを実行する。URL提示型はボディなし、入力型は入力値を送る。失敗はトースト、成功は状態を再取得する。
   * 入力: credentials(入力型のときのみ。秘密を含むため、この関数内でログ・画面へ出さない)。
   * 出力: なし（例外は投げない）。
   */
  async function handleLogin(credentials?: { username: string; password: string; twoFactorCode?: string }): Promise<void> {
    setIsSubmitting(true);
    setResult(undefined);
    try {
      const response = await postV1Session(credentials ?? null);
      if (response.status !== 200) {
        notifyError(describeApiError(response.status, response.data, "ログインに失敗しました"));
        return;
      }
      if (credentials) {
        notifySuccess(response.data.message);
      } else {
        setResult(response.data);
      }
      onChanged();
    } catch (caughtError) {
      notifyError(describeThrownError(caughtError, "ログインに失敗しました"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout(): Promise<void> {
    // 接続中のVPNも終了し、再ログインが必要になるため、誤操作を避けて確認する。
    if (!window.confirm("ログアウトしますか？（接続中のVPNは切断されます）")) return;
    setIsSubmitting(true);
    try {
      const response = await deleteV1Session();
      if (response.status !== 200) {
        notifyError(describeApiError(response.status, response.data, "ログアウトに失敗しました"));
        return;
      }
      setResult(undefined);
      notifySuccess("ログアウトしました");
      onChanged();
    } catch (caughtError) {
      notifyError(describeThrownError(caughtError, "ログアウトに失敗しました"));
    } finally {
      setIsSubmitting(false);
    }
  }

  // プラン名の直後に補足情報（例: 今月分の残りデータ通信量）があれば括弧書きで併記する（Phase 13）。
  // CLIの文言をそのまま出し、意味の解釈・翻訳はしない。
  const planText = session?.plan ? `${session.plan.label}${session.plan.usageNote ? `・${session.plan.usageNote}` : ""}` : undefined;
  const statusText =
    loggedIn === true
      ? `ログイン済み${planText ? `（プラン: ${planText}）` : ""}`
      : loggedIn === false
        ? "未ログイン"
        : undefined;

  return (
    <div className="session-card">
      {disconnectAction || connectAction || statusText ? (
        <div className="session-top-row">
          {disconnectAction}
          {connectAction}
          {statusText ? (
            <p className="session-status">
              アカウント: <strong>{statusText}</strong>
            </p>
          ) : null}
        </div>
      ) : null}
      {loggedIn !== true && canLogin ? (
        loginMethod === "credentials" ? (
          <LoginForm isSubmitting={isSubmitting} onSubmit={(credentials) => handleLogin(credentials)} />
        ) : (
          <div className="login">
            <button type="button" disabled={isSubmitting} onClick={() => void handleLogin()}>
              {isSubmitting ? "処理中..." : "VPNベンダーへログイン"}
            </button>
            {result ? (
              <p className="hint">
                {result.message}
                {result.loginUrl ? (
                  <>
                    {" "}
                    <a href={result.loginUrl} target="_blank" rel="noreferrer">
                      ログインURLを開く
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        )
      ) : null}
      {loggedIn !== true && !canLogin ? <RestrictionNote message={reasonOf(capabilities, "login")} /> : null}
      {loggedIn === true ? (
        <div className="session-actions">
          <button
            type="button"
            disabled={isSubmitting || !canLogout}
            aria-describedby={canLogout ? undefined : "logout-restriction"}
            onClick={() => void handleLogout()}
          >
            ログアウト
          </button>
          <RestrictionNote id="logout-restriction" message={logoutReason} />
        </div>
      ) : null}
    </div>
  );
}
