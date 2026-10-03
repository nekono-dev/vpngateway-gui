// 雛形: ユーザー名＋パスワード（＋任意の2段階認証）のログインフォーム。
// Proton Passが自動入力できる構成（SKILL.md「疑うポイント」#1・#7）。
// 守ること:
// - autoCompleteはusername / current-password。offにしない（フォームが出なくなる）。
// - 2段階認証欄は最初から<form>に置かない。ボタンで後から追加する（同居するとPassが反応しない）。
//   追加後はPassのフォームが出なくなるので、先に自動入力させてからボタンを押す運用になる。
// - 2段階認証欄・送信ボタンを<form>の外へ出してform属性で関連づけない（アプリ内で<main>全体がフォーム扱いされた）。
// - 秘密（パスワード・コード）は送信直後にstateから消す。
import { useState, type FormEvent } from "react";

interface Props {
  isSubmitting: boolean;
  // TODO: 送信処理（API呼び出し）。成功・失敗の通知は呼び出し側が行う。
  onSubmit: (credentials: { username: string; password: string; twoFactorCode?: string }) => Promise<void>;
}

export function LoginFormTemplate({ isSubmitting, onSubmit }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [showTwoFactor, setShowTwoFactor] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const code = twoFactorCode.trim();
    setPassword("");
    setTwoFactorCode("");
    await onSubmit({ username: username.trim(), password, ...(code.length > 0 ? { twoFactorCode: code } : {}) });
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
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
      <button type="submit" disabled={isSubmitting || username.trim() === "" || password === ""}>
        {isSubmitting ? "ログイン中..." : "ログイン"}
      </button>
    </form>
  );
}
