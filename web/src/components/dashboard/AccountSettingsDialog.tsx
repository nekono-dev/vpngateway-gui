// 責務: アカウント変更フォーム（AccountSettingsForm）を独立したダイアログとして表示する。
// 設定ダイアログ（SettingsDialog）とは別の関心事（PUT /v1/operator）のため、設定ダイアログの
// 「アカウント情報を変更」ボタンから開く、重ねて表示するダイアログに分離する。

import { useDialogOpen } from "../../hooks/useDialogOpen";
import { AccountSettingsForm } from "./AccountSettingsForm";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AccountSettingsDialog({ open, onClose }: Props) {
  const dialogRef = useDialogOpen(open, false);

  return (
    <dialog
      ref={dialogRef}
      className="non-modal"
      onClose={onClose}
      onKeyDown={(event) => event.key === "Escape" && onClose()}
      aria-label="アカウント設定"
    >
      {/* 閉じている間はフォームを描画しない（パスワードマネージャは、開いたときに追加された要素を確実に検出するため） */}
      {open ? <AccountSettingsForm /> : null}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
    </dialog>
  );
}
