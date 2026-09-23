// 責務: 設定ダイアログ内のアカウント変更フォーム（現在のパスワード確認＋ユーザー名・パスワードの変更）。
// webserver/design.md「利用者認証の実装方針」参照。接続設定（SettingsDialog本体）とは別のPUT
// （`PUT /v1/operator`）のため、保存・エラー状態を分離した独立フォームとする。

import { useState } from "react";
import { putV1Operator } from "../../generated/api/default/default";
import { describeApiError, describeThrownError } from "../../notifications/describe-api-error";

export function AccountSettingsForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [username, setUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!username && !newPassword) {
      setError("ユーザー名または新しいパスワードを入力してください");
      return;
    }
    setIsSaving(true);
    setError(undefined);
    setDone(false);
    try {
      const response = await putV1Operator({
        currentPassword,
        ...(username ? { username } : {}),
        ...(newPassword ? { newPassword } : {}),
      });
      if (response.status === 401) {
        setError("現在のパスワードが正しくありません");
        return;
      }
      if (response.status !== 200) {
        setError(describeApiError(response.status, response.data, "アカウントの変更に失敗しました").summary);
        return;
      }
      setDone(true);
      setUsername("");
      setNewPassword("");
    } catch (caughtError) {
      setError(describeThrownError(caughtError, "アカウントの変更に失敗しました").summary);
    } finally {
      setCurrentPassword("");
      setIsSaving(false);
    }
  }

  return (
    <form className="account-settings-form" onSubmit={(event) => void handleSubmit(event)}>
      <h3>アカウント</h3>
      <label>
        現在のパスワード
        <input
          type="password"
          autoComplete="off"
          required
          value={currentPassword}
          disabled={isSaving}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      <label>
        新しいユーザー名（変更する場合のみ）
        <input type="text" autoComplete="off" value={username} disabled={isSaving} onChange={(event) => setUsername(event.target.value)} />
      </label>
      <label>
        新しいパスワード（変更する場合のみ、8文字以上）
        <input
          type="password"
          autoComplete="off"
          minLength={8}
          value={newPassword}
          disabled={isSaving}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {done ? <p role="status">変更しました</p> : null}
      <button type="submit" disabled={isSaving}>
        {isSaving ? "変更中..." : "アカウントを変更"}
      </button>
    </form>
  );
}
