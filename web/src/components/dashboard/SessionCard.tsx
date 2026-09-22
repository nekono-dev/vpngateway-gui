// 責務: VPNプロバイダのログイン状態（ログイン済み・プラン名・未ログイン）の表示、ログイン導線
// （`loginMethod`で切替: URL提示型のボタン／ユーザー名・パスワード入力型のフォーム）、ログアウトの組み立てのみを行う。
// ログイン完了後の状態反映は、ダッシュボードの状態ポーリング（useDashboardPolling）を即時再取得させて行う
// （従来の`VpnLoginButton`を置換。webserver/design.md「コンポーネントと責務」）。
// 【Phase 21】ログイン導線はVPNベンダーを選ぶカードにまとめる（接続操作カードとは分離する）ため、
// 接続・切断ボタンはApp側で別カード（接続状態のカード）へ組み立て、ここでは扱わない
// （webserver/requirements.md「ダッシュボードのカード構成・レイアウトの整理」）。
// 【Phase 23】ベンダー選択のプルダウンの隣に置けるよう、ログイン/ログアウトの単発ボタン（`session-action`）と
// それ以外の状態表示・フォーム（`session-extra`）を別要素として返す。親（App）がCSS Gridで
// `session-action`をプルダウンと同じ行に、`session-extra`をその下の行に配置する
// （webserver/requirements.md「ベンダー選択のプルダウン化」）。
// 【Phase 24】資格情報入力型（`loginMethod: "credentials"`）も、フォームをいきなり表示するのではなく、
// URL提示型と同様に「ログイン」ボタンをプルダウンの隣に置き、押したときだけ下の行へフォームを開く
// （webserver/requirements.md「ログインボタンもプルダウンの隣へ」）。フォームを開いたあとはこのボタンを
// 隠す（フォーム自身の送信ボタンと表示名が重複するため）。
import { Fragment, useState } from "react";
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
}

export function SessionCard({ session, capabilities, onChanged }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // URL提示型のログインで返されたURL・メッセージ。
  const [result, setResult] = useState<{ loginUrl?: string; message: string }>();
  // 資格情報入力型ログインで、「ログイン」ボタンを押してフォームを開いたか（Phase 24）。
  const [showCredentialsForm, setShowCredentialsForm] = useState(false);
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

  // プルダウンの隣（session-action）に置くボタン: ログイン済みはログアウトボタン、未ログインは
  // 「ログイン」ボタン（URL提示型はそのままログインを実行、資格情報入力型は下の行のフォームを開くだけ）。
  // 資格情報入力型でフォームを開いた後は、フォーム自身の送信ボタン（同じ「ログイン」表示）と重複するため隠す。
  const showLoginButton = loggedIn !== true && canLogin && !(loginMethod === "credentials" && showCredentialsForm);

  function handleLoginButtonClick(): void {
    if (loginMethod === "credentials") {
      setShowCredentialsForm(true);
      return;
    }
    void handleLogin();
  }

  return (
    <Fragment>
      <div className="session-action">
        {loggedIn === true ? (
          <button
            type="button"
            disabled={isSubmitting || !canLogout}
            aria-describedby={canLogout ? undefined : "logout-restriction"}
            onClick={() => void handleLogout()}
          >
            ログアウト
          </button>
        ) : null}
        {showLoginButton ? (
          <button type="button" disabled={isSubmitting} onClick={handleLoginButtonClick}>
            {isSubmitting ? "処理中..." : loginMethod === "credentials" ? "ログイン" : "VPNベンダーへログイン"}
          </button>
        ) : null}
      </div>
      <div className="session-extra">
        {/* ログイン状態は接続状態の表示と同様に色で分かるようにする（Phase 22）。未ログインはログインフォーム・
            ログインボタン自体が示すため、「未ログイン」の文言は表示しない。 */}
        {loggedIn === true ? (
          <p className="session-status">
            アカウント: <span className="badge badge-ok">ログイン済み{planText ? `（プラン: ${planText}）` : ""}</span>
          </p>
        ) : null}
        {loggedIn === true ? <RestrictionNote id="logout-restriction" message={logoutReason} /> : null}
        {loggedIn !== true && canLogin ? (
          loginMethod === "credentials" ? (
            showCredentialsForm ? <LoginForm isSubmitting={isSubmitting} onSubmit={(credentials) => handleLogin(credentials)} /> : null
          ) : result ? (
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
          ) : null
        ) : null}
        {loggedIn !== true && !canLogin ? <RestrictionNote message={reasonOf(capabilities, "login")} /> : null}
      </div>
    </Fragment>
  );
}
