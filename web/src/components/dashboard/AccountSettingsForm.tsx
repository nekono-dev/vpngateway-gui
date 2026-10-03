// 責務: 設定ダイアログ内のアカウント変更フォーム（現在のパスワード確認＋ユーザー名・パスワードの変更）。
// webserver/design.md「利用者認証の実装方針」参照。接続設定（SettingsDialog本体）とは別のPUT
// （`PUT /v1/operator`）のため、保存・エラー状態を分離した独立フォームとする。

import { useState } from "react";
import { useCurrentUsername } from "../../contexts/AuthContext";
import { putV1Operator } from "../../generated/api/default/default";
import {
  describeApiError,
  describeThrownError,
} from "../../notifications/describe-api-error";

export function AccountSettingsForm() {
  const currentUsername = useCurrentUsername();
  const [currentPassword, setCurrentPassword] = useState("");
  // ユーザー名欄は現在のユーザー名を初期値とし、書き換えた場合のみ変更として送る。
  // 「新しいユーザー名」の別欄を置くと、パスワードマネージャが現在のパスワード欄へ新パスワードを入れてしまうため。
  const [savedUsername, setSavedUsername] = useState(currentUsername);
  const [username, setUsername] = useState(currentUsername);
  const [newPassword, setNewPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const usernameChanged = username !== "" && username !== savedUsername;
    if (!usernameChanged && !newPassword) {
      setError("ユーザー名または新しいパスワードを入力してください");
      return;
    }
    setIsSaving(true);
    setError(undefined);
    setDone(false);
    try {
      const response = await putV1Operator({
        currentPassword,
        ...(usernameChanged ? { username } : {}),
        ...(newPassword ? { newPassword } : {}),
      });
      if (response.status === 401) {
        setError("現在のパスワードが正しくありません");
        return;
      }
      if (response.status !== 200) {
        setError(
          describeApiError(
            response.status,
            response.data,
            "アカウントの変更に失敗しました",
          ).summary,
        );
        return;
      }
      setDone(true);
      if (usernameChanged) setSavedUsername(username);
      setNewPassword("");
    } catch (caughtError) {
      setError(
        describeThrownError(caughtError, "アカウントの変更に失敗しました")
          .summary,
      );
    } finally {
      setCurrentPassword("");
      setIsSaving(false);
    }
  }

  return (
    <form
      className="account-settings-form"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <h2>アカウント</h2>
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
        新しいパスワード（変更する場合のみ、4文字以上）
        <input
          type="password"
          name="new-password"
          autoComplete="new-password"
          minLength={4}
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
