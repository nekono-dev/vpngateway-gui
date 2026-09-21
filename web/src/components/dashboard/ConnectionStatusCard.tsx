// 責務: 現在の接続状態（接続中/切断/取得中/エラー）の表示のみを行う。業務ロジックは持たない。

import type { ConnectionState } from "../../hooks/useDashboardPolling";

interface Props {
  connection: ConnectionState | undefined;
  isLoading: boolean;
  error: string | undefined;
}

export function ConnectionStatusCard({ connection, isLoading, error }: Props) {
  if (error) {
    return (
      <div role="alert" className="card card-danger">
        <strong>接続状態を取得できませんでした</strong>
        <p>{error}</p>
      </div>
    );
  }

  if (isLoading || !connection) {
    return <div className="card">接続状態を取得中...</div>;
  }

  return (
    <div className={`card card-${connection.status}`}>
      <strong className="connection-label">{connection.status === "connected" ? "接続中" : "切断"}</strong>
      {connection.status === "connected" && connection.country ? (
        <span>
          {" "}
          （接続国: {connection.country.toUpperCase()}
          {connection.location ? ` / ${connection.location}` : ""}）
        </span>
      ) : null}
    </div>
  );
}
