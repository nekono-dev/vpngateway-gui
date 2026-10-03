// 雛形: ユーザー名・パスワードを変更するフォーム（現在のパスワード確認つき）。
// SKILL.md「疑うポイント」#1・#4・#5。
// 守ること:
// - 欄順は「ユーザー名(username)・現在のパスワード(current-password)・新パスワード(new-password)」の3欄。
// - 「新しいユーザー名」の別text欄を置かない（位置・autocompleteによらず、現在のパスワード欄へ新パスワードが入る）。
//   ユーザー名の変更は、username欄を現在値で初期化して、書き換えた場合だけ送る。
// - ラベルに「確認」「再入力」を含めない（確認欄と誤判定される）。
// - ダイアログ内に置く場合は NonModalPasswordDialog.template.tsx のとおり、開いたときだけ描画する。
import { useState, type FormEvent } from "react";

interface Props {
  // 現在のユーザー名（認証状態から取得した値など）。
  currentUsername: string;
  // TODO: 送信処理（API呼び出し）。ユーザー名は変更した場合のみ渡す。
  onSubmit: (input: { currentPassword: string; username?: string; newPassword?: string }) => Promise<void>;
}

export function ChangePasswordFormTemplate({ currentUsername, onSubmit }: Props) {
  const [username, setUsername] = useState(currentUsername);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const usernameChanged = username !== "" && username !== currentUsername;
    setIsSaving(true);
    try {
      await onSubmit({
        currentPassword,
        ...(usernameChanged ? { username } : {}),
        ...(newPassword ? { newPassword } : {}),
      });
      setNewPassword("");
    } finally {
      setCurrentPassword("");
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <label>
        ユーザー名（変更する場合は書き換える）
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={username}
          disabled={isSaving}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label>
        現在のパスワード
        <input
          type="password"
          name="current-password"
          autoComplete="current-password"
          required
          value={currentPassword}
          disabled={isSaving}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      <label>
        新しいパスワード（変更する場合のみ）
        <input
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={newPassword}
          disabled={isSaving}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </label>
      <button type="submit" disabled={isSaving}>
        {isSaving ? "変更中..." : "変更"}
      </button>
    </form>
  );
}
