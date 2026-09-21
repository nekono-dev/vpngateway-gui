// 責務: 任意の取得関数を一定間隔でポーリングする汎用フック。画面表示中（タブがvisible）のみポーリングする。
// webserver/design.md「状態管理の実装方針」参照（WebSocket等のプッシュ型通信は初期実装では採用しない）。
// ドメイン型に依存しない（ポータビリティテスト適合）ため hooks/ 直下に置く。

import { useEffect, useState } from "react";

interface PollingResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: string | undefined;
  refresh: () => void;
}

const DEFAULT_INTERVAL_MS = 5000;

/**
 * 目的: `fetcher`を一定間隔で呼び出し、最新の取得結果を返す。
 * 入力: fetcher(取得する非同期関数。失敗はthrowで表す), intervalMs(ポーリング間隔、省略時5000ms)。
 * 出力: 最新の取得結果・ローディング状態・エラーメッセージ・即時再取得関数。
 * 副作用: `document.visibilityState`が"hidden"の間はポーリングを停止し、タブが再表示された際に再開する。
 *        失敗時は直前の取得結果を保持したままerrorのみ更新する（一時的な失敗で表示が消えるのを避ける）。
 * 例: const { data, error } = usePolling(() => fetchSomething());
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number = DEFAULT_INTERVAL_MS): PollingResult<T> {
  const [data, setData] = useState<T>();
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
        const result = await fetcher();
        if (!cancelled) {
          setData(result);
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

    void poll();
    const timer = setInterval(() => void poll(), intervalMs);
    const handleVisibilityChange = () => void poll();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, refreshToken]);

  return {
    data,
    isLoading,
    error,
    refresh: () => setRefreshToken((token) => token + 1),
  };
}
