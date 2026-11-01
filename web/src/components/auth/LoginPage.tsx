// 責務: ログイン画面。アカウント作成済みで未ログインの場合に表示する。
//API呼び出しは生成クライアント以外を使わない。

import { useState } from "react";
import { postV1OperatorSession } from "../../generated/api/default/default";
import { describeApiError, describeThrownError } from "../../notifications/describe-api-error";
import { useAuth } from "../../contexts/AuthContext";

const LOGIN_FAILED = "ログインに失敗しました";

/**
 * 目的: ログインのPOSTを送る。応答を得られなかった通信例外（接続の再利用失敗・一時的な通信断）だけを1回だけ再送する。
 *       HTTPステータスとしての失敗（401・429・5xx）は再送しない（レート制限の計数を増やさないため）。
 * 入力: username・password（送信する資格情報）。
 * 出力: 生成クライアントの応答。2回とも例外になった場合は2回目の例外を投げる。
 * 副作用: 通信例外のときだけ、もう一度POSTを送る（セッションは失敗時に作られないため、二重のログインにはならない）。
 * 例: const response = await sendLoginWithRetry({ username: "admin", password: "..." });
 */
async function sendLoginWithRetry(body: { username: string; password: string }) {
  try {
    return await postV1OperatorSession(body);
  } catch (firstError) {
    // 開発者向けに1回目の例外を残す（画面の要約には出さない）。
    console.warn("login request failed, retrying once", firstError);
    return postV1OperatorSession(body);
  }
}

/**
 * 目的: ログインの応答（401・429以外）を、画面に出す失敗の文言へ変換する。
 * 入力: status(HTTPステータス), data(応答本文。unknown)。
 * 出力: 表示する文言。502はWebサーバが上流のAPIサーバへ到達できなかったことを示すため「APIサーバに接続できません」とする。
 * 例: loginFailureMessage(502, { error: "bad_gateway" }) // => "ログインに失敗しました（APIサーバに接続できません）"
 */
function loginFailureMessage(status: number, data: unknown): string {
  if (status === 502) {
    return `${LOGIN_FAILED}（APIサーバに接続できません）`;
  }
  return describeApiError(status, data, LOGIN_FAILED).summary;
}

export function LoginPage() {
  const { setAuthenticated } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError(undefined);
    try {
      const response = await sendLoginWithRetry({ username, password });
      if (response.status === 401) {
        setError("ユーザー名またはパスワードが正しくありません");
        return;
      }
      if (response.status === 429) {
        setError("試行回数が多すぎます。しばらく待ってから再度お試しください");
        return;
      }
      // 2xxだけを成功とする。それ以外（500・502・504等）を成功扱いすると、利用できない状態でダッシュボードへ進んでしまう。
      if (response.status < 200 || response.status >= 300) {
        setError(loginFailureMessage(response.status, response.data));
        return;
      }
      setAuthenticated(username);
    } catch (caughtError) {
      setError(describeThrownError(caughtError, LOGIN_FAILED).summary);
    } finally {
      setPassword("");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-card" onSubmit={(event) => void handleSubmit(event)}>
        <h1>ログイン</h1>
        <label>
          ユーザー名
          <input
            type="text"
            name="username"
            autoComplete="username"
            required
            value={username}
            disabled={isSubmitting}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          パスワード
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            disabled={isSubmitting}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "ログイン中..." : "ログイン"}
        </button>
      </form>
    </main>
  );
}
