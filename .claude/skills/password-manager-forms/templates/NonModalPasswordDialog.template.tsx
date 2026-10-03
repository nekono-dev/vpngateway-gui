// 雛形: パスワード欄を持つ非モーダルのダイアログ（パスワードを再入力する確認ダイアログなど）。
// SKILL.md「疑うポイント」#2・#3・#5。
// 守ること:
// - モーダル（showModal）にしない。トップレイヤーが拡張機能の候補表示を隠す。dialog.show()で開き、
//   non-modal-dialog.cssで中央に固定する（className="non-modal"）。
// - モーダルでないとEscで閉じないので、onKeyDownで補う。
// - 閉じている間はフォームを描画しない（閉じた<dialog>内のフォームは、開いても再検出されない）。
// - 「ログイン中のユーザー名」を可視のtext欄（autoComplete="username"）で置く。非表示・readOnlyの欄は検出されない。
// - 重ねて開く親がモーダルなら、親は子が開いている間だけ表示を閉じる（親のshowModal中は、非モーダルの子も
//   トップレイヤーの下になるため）。親の状態は保持し、onCloseは呼ばない。
// - パスワードを非制御入力（ref）にするのは必須ではない（制御入力でも自動入力できた）。値を保持しない目的で使う。
import { useEffect, useRef, useState, type FormEvent } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  // 現在のユーザー名（認証状態から取得した値）。
  currentUsername: string;
}

// 非モーダルで開閉する。jsdomにはshow()が無いので、単体テストでは`open`属性を切り替えるポリフィルを用意する。
function useNonModalDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.show();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}

export function NonModalPasswordDialogTemplate({ open, onClose, currentUsername }: Props) {
  const dialogRef = useNonModalDialog(open);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 開くたびに、前回の入力を引き継がない。
  useEffect(() => {
    if (open && passwordRef.current) passwordRef.current.value = "";
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      // TODO: API呼び出し（passwordRef.current?.value を送る）。
    } finally {
      if (passwordRef.current) passwordRef.current.value = "";
      setIsSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="non-modal"
      onClose={onClose}
      onKeyDown={(event) => event.key === "Escape" && onClose()}
      aria-label="TODO: ダイアログ名"
    >
      <h2>TODO: 見出し</h2>
      {open ? (
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label>
            ログイン中のユーザー名
            <input type="text" name="username" autoComplete="username" defaultValue={currentUsername} />
          </label>
          <label>
            ログインパスワード
            <input
              type="password"
              name="current-password"
              autoComplete="current-password"
              required
              ref={passwordRef}
              disabled={isSubmitting}
            />
          </label>
          <div className="dialog-actions">
            <button type="submit" disabled={isSubmitting}>
              実行
            </button>
            <button type="button" disabled={isSubmitting} onClick={onClose}>
              キャンセル
            </button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}
