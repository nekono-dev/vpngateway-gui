// 責務: VPNベンダーへのログイン代行（`POST /v1/session`）を開始するボタンの表示と、
// 返却されたログインURL・メッセージの表示のみを行う。ログイン完了後の状態反映は
// 既存の接続状態ポーリング（useDashboardPolling）に委ね、ここでは待機処理を持たない。

import { useState } from "react";
import { postV1Session } from "../../generated/api/default/default";
import { describeApiError, describeThrownError } from "../../notifications/describe-api-error";
import { useToast } from "../../notifications/ToastProvider";

export function VpnLoginButton() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ loginUrl?: string; message: string }>();
  const { notifyError } = useToast();

  async function handleLogin(): Promise<void> {
    setIsSubmitting(true);
    setResult(undefined);
    try {
      const response = await postV1Session();
      if (response.status !== 200) {
        notifyError(describeApiError(response.status, response.data, "ログインに失敗しました"));
        return;
      }
      setResult(response.data);
    } catch (caughtError) {
      notifyError(describeThrownError(caughtError, "ログインに失敗しました"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login">
      <button type="button" disabled={isSubmitting} onClick={() => void handleLogin()}>
        {isSubmitting ? "処理中..." : "VPNベンダーへログイン"}
      </button>
      {result ? (
        <p className="hint">
          {result.message}
          {result.loginUrl ? (
            <>
              {" "}
              <a href={result.loginUrl} target="_blank" rel="noreferrer">
                ログインURLを開く
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
