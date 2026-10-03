// 責務: ゲートウェイ機（ベアメタル）の再起動の確認・パスワード再入力・依頼（`POST /v1/gateway/reboot`）。
// webserver/design.md「ゲートウェイ機の再起動の実装方針」参照。エラーはダイアログ内に表示する
// （モーダル表示中はダイアログ外のトーストが操作不能になるため）。

import { useEffect, useRef, useState } from "react";
import { postV1GatewayReboot } from "../../generated/api/default/default";
import { useCurrentUsername } from "../../contexts/AuthContext";
import { useDialogOpen } from "../../hooks/useDialogOpen";
import {
  describeApiError,
  describeThrownError,
} from "../../notifications/describe-api-error";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RebootDialog({ open, onClose }: Props) {
  const currentUsername = useCurrentUsername();
  const dialogRef = useDialogOpen(open, false);
  // パスワードは非制御入力（ref）で読む。パスワードマネージャが`value`を直接書き換えた値を、Reactの再描画で
  // stateの値（空）へ戻されないようにするため。
  const passwordRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [requested, setRequested] = useState(false);

  // 開くたびに、前回の入力・結果を引き継がない（パスワードを保持しない）。
  useEffect(() => {
    if (open) {
      if (passwordRef.current) passwordRef.current.value = "";
      setError(undefined);
      setRequested(false);
    }
  }, [open]);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError(undefined);
    try {
      const response = await postV1GatewayReboot({
        password: passwordRef.current?.value ?? "",
      });
      if (response.status === 202) {
        setRequested(true);
        return;
      }
      if (response.status === 401) {
        setError("パスワードが正しくありません");
        return;
      }
      if (response.status === 503) {
        setError(
          "ゲートウェイ機に再起動の仕組みが導入されていません（インストーラの再実行が必要です）",
        );
        return;
      }
      if (response.status === 409) {
        setError("すでに再起動を依頼済みです。しばらくお待ちください");
        return;
      }
      setError(
        describeApiError(
          response.status,
          response.data,
          "再起動の依頼に失敗しました",
        ).summary,
      );
    } catch (caughtError) {
      setError(
        describeThrownError(caughtError, "再起動の依頼に失敗しました").summary,
      );
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
      aria-label="ゲートウェイ再起動"
    >
      <h2>ゲートウェイ再起動</h2>
      {/* 閉じている間はフォームを描画しない（パスワードマネージャは、開いたときに追加された要素を確実に検出するため） */}
      {!open ? null : requested ? (
        <>
          <p role="status">
            再起動を依頼しました。ゲートウェイ機が再起動する間、VPN・LAN機器の通信と、この画面への接続ができなくなります。
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              閉じる
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)}>
          <p>
            ゲートウェイ機（ベンダーが動作しているサーバ）のOSを再起動します。再起動が完了するまでの間、VPN・LAN機器の通信が止まります。
          </p>
          <label>
            ログイン中のユーザー名
            <input
              type="text"
              name="username"
              autoComplete="username"
              defaultValue={currentUsername}
            />
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
          {error ? <p role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "依頼中..." : "再起動"}
            </button>
            <button type="button" disabled={isSubmitting} onClick={onClose}>
              キャンセル
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
