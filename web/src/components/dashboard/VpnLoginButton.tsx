// 責務: VPNベンダーへのログイン代行（`POST /v1/session`）を開始するボタンの表示と、
// 返却されたログインURL・メッセージの表示のみを行う。ログイン完了後の状態反映は
// 既存の接続状態ポーリング（useConnectionPolling）に委ね、ここでは待機処理を持たない。

import { useState } from "react";
import { postV1Session } from "../../generated/api/default/default";

export function VpnLoginButton() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ loginUrl?: string; message: string }>();
  const [error, setError] = useState<string>();

  async function handleLogin(): Promise<void> {
    setIsSubmitting(true);
    setError(undefined);
    setResult(undefined);
    try {
      const response = await postV1Session();
      if (response.status !== 200) {
        const message = "message" in response.data ? response.data.message : undefined;
        throw new Error(message ?? `ログインに失敗しました (status: ${response.status})`);
      }
      setResult(response.data);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <button type="button" disabled={isSubmitting} onClick={() => void handleLogin()}>
        {isSubmitting ? "処理中..." : "VPNベンダーへログイン"}
      </button>
      {result ? (
        <p>
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
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
