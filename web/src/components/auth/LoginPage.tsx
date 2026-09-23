// 責務: ログイン画面。アカウント作成済みで未ログインの場合に表示する。
// webserver/design.md「利用者認証の実装方針」参照。API呼び出しは生成クライアント以外を使わない。

import { useState } from "react";
import { postV1OperatorSession } from "../../generated/api/default/default";
import { describeThrownError } from "../../notifications/describe-api-error";
import { useAuth } from "../../contexts/AuthContext";

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
      const response = await postV1OperatorSession({ username, password });
      if (response.status === 401) {
        setError("ユーザー名またはパスワードが正しくありません");
        return;
      }
      if (response.status === 429) {
        setError("試行回数が多すぎます。しばらく待ってから再度お試しください");
        return;
      }
      setAuthenticated(username);
    } catch (caughtError) {
      setError(describeThrownError(caughtError, "ログインに失敗しました").summary);
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
            autoComplete="off"
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
            autoComplete="off"
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
