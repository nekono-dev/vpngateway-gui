// 責務: 透過ゲートウェイ／明示的プロキシの「実際の稼働状況」（`GET /v1/connection/gateway`）の表示のみを行う。
// 設定値（`GET /v1/connection/config`）とは別物で、設定ONでも未構成・適用エラーになりうることを示す。
// 明示的プロキシはPhase 4（3proxy）未実装のため「未対応」の暫定表示（Phase 4で実状態表示へ置換する）。

import type { GatewayStatus } from "../../hooks/useDashboardPolling";

interface Props {
  gateway: GatewayStatus | undefined;
  gatewayError: string | undefined;
  isLoading: boolean;
}

interface Badge {
  label: string;
  tone: "ok" | "warn" | "danger" | "muted";
}

/**
 * 目的: 透過ゲートウェイの稼働状況を、表示ラベルと色調（tone）へ変換する。
 * 入力: transparentGateway(APIレスポンスのtransparentGatewayオブジェクト)。
 * 出力: Badge。Kill Switch遮断中は「稼働中」より優先して警告色で示す（LAN機器の通信が止まっているため）。
 * 例: toBadge({ state: "active", killSwitchBlocking: true }) // => { label: "Kill Switchにより遮断中", tone: "warn" }
 */
function toBadge(transparentGateway: GatewayStatus["transparentGateway"]): Badge {
  switch (transparentGateway.state) {
    case "active":
      return transparentGateway.killSwitchBlocking
        ? { label: "Kill Switchにより遮断中（VPN未接続）", tone: "warn" }
        : { label: "稼働中", tone: "ok" };
    case "stopped":
      return { label: "停止", tone: "muted" };
    case "unconfigured":
      return { label: "未構成（LAN_IFACE未設定）", tone: "warn" };
    case "error":
      return { label: "ルール適用エラー", tone: "danger" };
  }
}

export function GatewayStatusCard({ gateway, gatewayError, isLoading }: Props) {
  let transparentGatewayView;
  if (gatewayError) {
    transparentGatewayView = (
      <span className="badge badge-danger" role="alert">
        取得失敗: {gatewayError}
      </span>
    );
  } else if (isLoading || !gateway) {
    transparentGatewayView = <span className="badge badge-muted">取得中...</span>;
  } else {
    const badge = toBadge(gateway.transparentGateway);
    transparentGatewayView = (
      <>
        <span className={`badge badge-${badge.tone}`}>{badge.label}</span>
        {gateway.transparentGateway.vpnInterface ? (
          <span className="hint"> VPN IF: {gateway.transparentGateway.vpnInterface}</span>
        ) : null}
      </>
    );
  }

  return (
    <section className="card" aria-label="稼働状況">
      <h2>稼働状況</h2>
      <dl className="status-list">
        <dt>透過ゲートウェイ</dt>
        <dd>{transparentGatewayView}</dd>
        <dt>明示的プロキシ</dt>
        <dd>
          <span className="badge badge-muted">未対応（Phase 4で対応予定）</span>
        </dd>
      </dl>
    </section>
  );
}
