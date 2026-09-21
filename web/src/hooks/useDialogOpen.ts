// 責務: `<dialog>`要素の開閉状態（`open`プロパティ）を、React側の`open`状態へ同期する汎用フック。
// SettingsDialog・ConnectionLogDialogなど、モーダルダイアログ間で共有する。

import { useEffect, useRef } from "react";

/**
 * 目的: `open`の真偽に合わせて`<dialog>`を`showModal()`/`close()`する。
 * 入力: open(ダイアログを開くべきか)。
 * 出力: `<dialog ref={...}>`へ渡すref。
 * 副作用: DOMのダイアログ状態を変更する。すでに目的の状態であれば何もしない
 *        （ユーザがEscで閉じた後の再同期でInvalidStateErrorを起こさないため）。
 */
export function useDialogOpen(open: boolean) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialogElement = dialogRef.current;
    if (!dialogElement) return;
    if (open && !dialogElement.open) {
      dialogElement.showModal();
    } else if (!open && dialogElement.open) {
      dialogElement.close();
    }
  }, [open]);

  return dialogRef;
}
