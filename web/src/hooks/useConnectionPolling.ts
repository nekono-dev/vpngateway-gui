// 責務: 接続状態を一定間隔でポーリングするフック。画面表示中（タブがvisible）のみポーリングする。
// webserver/design.md「状態管理の実装方針」参照（WebSocket等のプッシュ型通信は初期実装では採用しない）。

import { useEffect, useState } from "react";

export interface ConnectionState {
  status: "connected" | "disconnected";
  country?: string;
}

interface PollingResult {
  connection: ConnectionState | undefined;
  isLoading: boolean;
  error: string | undefined;
  refresh: () => void;
}

const DEFAULT_INTERVAL_MS = 5000;

/**
 * 目的: `fetchStatus`を一定間隔で呼び出し、最新の接続状態を返す。
 * 入力: fetchStatus(接続状態を取得する非同期関数、生成APIクライアントの関数を渡す想定),
 *       intervalMs(ポーリング間隔、省略時5000ms)。
 * 出力: 現在の接続状態・ローディング状態・エラーメッセージ・即時再取得関数。
 * 副作用: `document.visibilityState`が"hidden"の間はポーリングを停止し、タブが再表示された際に再開する。
 */
export function useConnectionPolling(
  fetchStatus: () => Promise<ConnectionState>,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): PollingResult {
  const [connection, setConnection] = useState<ConnectionState>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      if (document.visibilityState !== "visible") {
        return;
      }
      try {
        const result = await fetchStatus();
        if (!cancelled) {
          setConnection(result);
          setError(undefined);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    poll();
    const timer = setInterval(poll, intervalMs);
    document.addEventListener("visibilitychange", poll);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, refreshToken]);

  return {
    connection,
    isLoading,
    error,
    refresh: () => setRefreshToken((token) => token + 1),
  };
}
