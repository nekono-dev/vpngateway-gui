// 責務: 設定の動作検証の開始・進行の取得（ポーリング）・ブラウザ側の観測（出口IPの取得と提出、検証用の名前の解決）。
// 設定ダイアログが開いている間の状態として保持し、閉じると破棄する（webserver/design.md「設定の動作検証の実装方針」）。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getV1VerificationsId,
  postV1Verifications,
  putV1VerificationsIdClientObservationsEgressIp,
} from "../generated/api/default/default";
import { describeApiError, describeThrownError } from "../notifications/describe-api-error";
import type { Verification } from "../components/dashboard/verification/verification-view";
import { fetchBrowserEgressIp, triggerDnsLookup } from "../components/dashboard/verification/browser-probes";

const POLL_INTERVAL_MS = 500;
const POLL_RETRY_MS = 1000;

export interface VerificationState {
  verification: Verification | undefined;
  isStarting: boolean;
  error: string | undefined;
  start: () => Promise<void>;
}

/**
 * 目的: 設定の動作検証を操作する。
 * 入力: active(設定ダイアログが開いているか。falseになると状態を破棄し、進行の取得を止める),
 *      echoUrl(保存済みのIP確認サービスのURL。検証は保存済みの設定に対して行うため、編集中の値ではない)。
 * 出力: 現在の検証・開始中か・エラー・開始の操作。
 */
export function useVerification(active: boolean, echoUrl: string | undefined): VerificationState {
  const [verification, setVerification] = useState<Verification>();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string>();
  // ダイアログを閉じた・開き直した後に、古い検証の非同期処理が状態を上書きしないよう、世代で区別する。
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const stopPolling = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  useEffect(() => {
    if (active) return;
    generation.current += 1;
    stopPolling();
    setVerification(undefined);
    setIsStarting(false);
    setError(undefined);
  }, [active, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback(
    (id: string, current: number) => {
      timer.current = setTimeout(() => {
        getV1VerificationsId(id)
          .then((response) => {
            if (current !== generation.current) return;
            if (response.status !== 200) {
              setError(describeApiError(response.status, response.data, "検証の進行を取得できませんでした").summary);
              return;
            }
            setError(undefined);
            setVerification(response.data);
            if (response.data.state === "running") poll(id, current);
          })
          .catch((caughtError: unknown) => {
            if (current !== generation.current) return;
            setError(describeThrownError(caughtError, "検証の進行を取得できませんでした").summary);
            // 一時的な失敗は、間隔を空けて取り直す。
            timer.current = setTimeout(() => poll(id, current), POLL_RETRY_MS);
          });
      }, POLL_INTERVAL_MS);
    },
    [],
  );

  const start = useCallback(async () => {
    const current = generation.current;
    stopPolling();
    setIsStarting(true);
    setError(undefined);
    try {
      const response = await postV1Verifications();
      if (current !== generation.current) return;
      if (response.status === 409) {
        setError("他の画面で動作検証を実行中です。完了してから、もう一度実行してください。");
        return;
      }
      if (response.status !== 202) {
        // 生成クライアントの型にない応答（401・500等）も、実行時には返りうる。
        const unexpected = response as { status: number; data: unknown };
        setError(describeApiError(unexpected.status, unexpected.data, "動作検証を開始できませんでした").summary);
        return;
      }
      const started = response.data;
      setVerification(started);
      // この端末からの確認（L3）の観測を、項目の順番を待たずに先行して行う（利用者の操作は不要）。
      if (started.clientProbe !== undefined) triggerDnsLookup(started.clientProbe.dnsName);
      const needsEgress = started.checks.some((check) => check.id === "client-egress" && check.status === "pending");
      if (needsEgress && echoUrl !== undefined) {
        void fetchBrowserEgressIp(echoUrl).then((ip) =>
          putV1VerificationsIdClientObservationsEgressIp(started.id, { ip }).catch(() => undefined),
        );
      }
      poll(started.id, current);
    } catch (caughtError) {
      if (current !== generation.current) return;
      setError(describeThrownError(caughtError, "動作検証を開始できませんでした").summary);
    } finally {
      if (current === generation.current) setIsStarting(false);
    }
  }, [echoUrl, poll, stopPolling]);

  return { verification, isStarting, error, start };
}
