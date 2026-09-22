// 責務: 現在の接続状態（接続中/切断/取得中/エラー）の表示のみを行う。業務ロジックは持たない。
// 【Phase 21】外枠（.card）は持たず、内容のみを返す。稼働状況・接続/切断ボタンと同じカードに
// まとめるため、外枠はApp側で1つにまとめて持つ（webserver/design.md「接続状態・稼働状況・
// 接続/切断ボタンを1枚のカードにまとめる」）。枠色の判定は`connectionCardClassName`を使う。
import type { ConnectionState } from "../../hooks/useDashboardPolling";

interface Props {
  connection: ConnectionState | undefined;
  isLoading: boolean;
  error: string | undefined;
  // 選択中のベンダー名。有効なベンダーが複数あるときだけ渡し、「接続中（<ベンダー名>）」の形で示す（Phase 11）。
  providerName?: string;
}

/**
 * 目的: 接続状態に応じた外枠の色分けクラス名を返す（従来ConnectionStatusCard内部が持っていた判定）。
 * 入力: connection(接続状態。未取得ならundefined), isLoading(取得中か), error(取得失敗の理由。あれば優先)。
 * 出力: 外枠へ付けるクラス名（"card card-danger"等）。
 * 例: connectionCardClassName(undefined, true, undefined) // => "card"
 */
export function connectionCardClassName(connection: ConnectionState | undefined, isLoading: boolean, error: string | undefined): string {
  if (error) return "card card-danger";
  if (isLoading || !connection) return "card";
  return `card card-${connection.status}`;
}

export function ConnectionStatusCard({ connection, isLoading, error, providerName }: Props) {
  if (error) {
    return (
      <div role="alert">
        <strong>接続状態を取得できませんでした</strong>
        <p>{error}</p>
      </div>
    );
  }

  if (isLoading || !connection) {
    return <p>接続状態を取得中...</p>;
  }

  return (
    <p className="connection-summary">
      <strong className="connection-label">{connection.status === "connected" ? "接続中" : "切断"}</strong>
      {providerName ? <span className="hint">（{providerName}）</span> : null}
      {connection.status === "connected" && connection.country ? (
        <span>
          {" "}
          （接続国: {connection.country.toUpperCase()}
          {connection.location ? ` / ${connection.location}` : ""}）
        </span>
      ) : null}
    </p>
  );
}
