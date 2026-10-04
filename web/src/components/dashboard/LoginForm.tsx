// 責務: ユーザー名・パスワード入力型のログイン（`loginMethod: "credentials"`）のフォーム表示と送信のみを行う。
// パスワード・2段階認証コードは秘密情報のため、送信の成否にかかわらず送信直後に入力欄から消す。
// 画面・トーストにも表示しない
// （webserver/requirements.md「秘密情報の扱い」、design.md「credentialsログインの実装上の注意」）。
// パスワードマネージャによる自動入力を使えるよう、autoCompleteはusername・current-passwordを指定する
// （offでは種別を判定できず反応しないため。design.md「操作者認証フォームのパスワードマネージャ対応」）。
// 2段階認証欄は、最初は表示せず、ボタンを押したときに<form>へ追加する（ユーザー名・パスワードと同じ
// <form>に最初から2段階認証欄があると、パスワードマネージャがパスワード欄へ自動入力しなかったため。実機検証による）。
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
  // 2段階認証欄を表示しているか（設定しているアカウントのみが、ボタンで開く）。
  const [showTwoFactor, setShowTwoFactor] = useState(false);

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
          autoComplete="username"
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
          value={password}
          disabled={isSubmitting}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {showTwoFactor ? (
        <label>
          2段階認証
          <input
            type="text"
            name="twoFactorCode"
            inputMode="numeric"
            autoComplete="off"
            placeholder="2段階認証コード"
            value={twoFactorCode}
            disabled={isSubmitting}
            onChange={(event) => setTwoFactorCode(event.target.value)}
          />
        </label>
      ) : (
        <button type="button" disabled={isSubmitting} onClick={() => setShowTwoFactor(true)}>
          2段階認証を設定している場合
        </button>
      )}
      <button type="submit" className="primary" disabled={isSubmitting || username.trim() === "" || password === ""}>
        {isSubmitting ? "ログイン中..." : "ログイン"}
      </button>
    </form>
  );
}
