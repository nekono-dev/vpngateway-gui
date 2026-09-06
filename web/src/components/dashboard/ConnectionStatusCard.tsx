// 責務: 現在の接続状態（接続中/切断/取得中/エラー）の表示のみを行う。業務ロジックは持たない。

import type { ConnectionState } from "../../hooks/useConnectionPolling";

interface Props {
  connection: ConnectionState | undefined;
  isLoading: boolean;
  error: string | undefined;
}

export function ConnectionStatusCard({ connection, isLoading, error }: Props) {
  if (error) {
    return (
      <div role="alert">
        <strong>接続状態を取得できませんでした</strong>
        <p>{error}</p>
      </div>
    );
  }

  if (isLoading || !connection) {
    return <div>接続状態を取得中...</div>;
  }

  return (
    <div>
      <strong>{connection.status === "connected" ? "接続中" : "切断"}</strong>
      {connection.status === "connected" && connection.country ? (
        <span> （接続国: {connection.country.toUpperCase()}）</span>
      ) : null}
    </div>
  );
}
