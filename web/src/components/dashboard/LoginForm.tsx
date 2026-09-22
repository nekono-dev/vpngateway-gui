// 責務: ユーザー名・パスワード入力型のログイン（`loginMethod: "credentials"`）のフォーム表示と送信のみを行う。
// パスワード・2段階認証コードは秘密情報のため、送信の成否にかかわらず送信直後に入力欄から消し、
// ブラウザへ保存させない（autoComplete="off"）。画面・トーストにも表示しない
// （webserver/requirements.md「秘密情報の扱い」、design.md「credentialsログインの実装上の注意」）。
import { useState, type FormEvent } from "react";

interface Props {
  // 送信中か。フォーム全体を無効化して二重送信を防ぐ。
  isSubmitting: boolean;
  // 送信する。成功・失敗の通知は呼び出し側が行う。
  onSubmit: (credentials: { username: string; password: string; twoFactorCode?: string }) => Promise<void>;
}

export function LoginForm({ isSubmitting, onSubmit }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const code = twoFactorCode.trim();
    // 秘密はstateから先に消す（送信の待機中・失敗後に画面へ残さない）。ユーザー名は再入力の手間を避けるため残す。
    setPassword("");
    setTwoFactorCode("");
    await onSubmit({ username: username.trim(), password, ...(code.length > 0 ? { twoFactorCode: code } : {}) });
  }

  return (
    <form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
      <label>
        ユーザー名
        <input
          type="text"
          name="username"
          autoComplete="off"
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
          autoComplete="off"
          value={password}
          disabled={isSubmitting}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label>
        2段階認証
        <input
          type="text"
          name="twoFactorCode"
          inputMode="numeric"
          autoComplete="off"
          placeholder="2段階認証を設定している場合のみ入力"
          value={twoFactorCode}
          disabled={isSubmitting}
          onChange={(event) => setTwoFactorCode(event.target.value)}
        />
      </label>
      <button type="submit" className="primary" disabled={isSubmitting || username.trim() === "" || password === ""}>
        {isSubmitting ? "ログイン中..." : "ログイン"}
      </button>
    </form>
  );
}
