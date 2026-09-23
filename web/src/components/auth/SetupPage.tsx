// 責務: 初期設定画面。アカウント未作成時に表示し、ユーザー名・パスワードの初回作成を行う。
// webserver/design.md「利用者認証の実装方針」参照。API呼び出しは生成クライアント以外を使わない。

import { useState } from "react";
import { postV1Operator } from "../../generated/api/default/default";
import { describeApiError, describeThrownError } from "../../notifications/describe-api-error";
import { useAuth } from "../../contexts/AuthContext";

export function SetupPage() {
  const { setAuthenticated } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (password !== passwordConfirm) {
      setError("パスワードが一致しません");
      return;
    }
    setIsSubmitting(true);
    setError(undefined);
    try {
      const response = await postV1Operator({ username, password });
      if (response.status === 409) {
        // 他の利用者が先に設定した場合、初期設定はできないためログイン画面へ促す。
        setError("既にアカウントが作成されています。ログインしてください。");
        return;
      }
      if (response.status !== 200) {
        setError(describeApiError(response.status, response.data, "初期設定に失敗しました").summary);
        return;
      }
      // POST /v1/operatorは作成と同時にセッションを発行するため、そのままダッシュボードへ遷移する。
      setAuthenticated(response.data.username ?? username);
    } catch (caughtError) {
      setError(describeThrownError(caughtError, "初期設定に失敗しました").summary);
    } finally {
      setPassword("");
      setPasswordConfirm("");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-card" onSubmit={(event) => void handleSubmit(event)}>
        <h1>初期設定</h1>
        <p>管理者アカウントのユーザー名とパスワードを設定してください。</p>
        <label>
          ユーザー名
          <input
            type="text"
            autoComplete="off"
            required
            value={username}
            disabled={isSubmitting}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          パスワード（4文字以上）
          <input
            type="password"
            autoComplete="off"
            required
            minLength={4}
            value={password}
            disabled={isSubmitting}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          パスワード（確認）
          <input
            type="password"
            autoComplete="off"
            required
            minLength={4}
            value={passwordConfirm}
            disabled={isSubmitting}
            onChange={(event) => setPasswordConfirm(event.target.value)}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "設定中..." : "設定する"}
        </button>
      </form>
    </main>
  );
}
