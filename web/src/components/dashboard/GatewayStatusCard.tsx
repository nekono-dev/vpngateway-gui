// 責務: 透過ゲートウェイ／明示的プロキシの「実際の稼働状況」（`GET /v1/connection/gateway`）の表示のみを行う。
// 設定値（`GET /v1/connection/config`）とは別物で、設定ONでも未構成・適用エラーになりうることを示す。
// 明示的プロキシ（3proxy、Phase 4）も同じ稼働状況エンドポイントから取得した実状態を表示する。
// 【Phase 21】外枠（.card）は持たず、内容のみを返す。接続状態・接続/切断ボタンと同じカードに
// まとめるため、外枠はApp側で持つ（webserver/design.md「接続状態・稼働状況・接続/切断ボタンを
// 1枚のカードにまとめる」）。

import type { ReactNode } from "react";
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

/**
 * 目的: 明示的プロキシの稼働状況を、表示ラベルと色調（tone）へ変換する。
 * 入力: explicitProxy(APIレスポンスのexplicitProxyオブジェクト)。
 * 出力: Badge。crashLoopは再起動回数を添えて、原因調査が必要な異常として danger で示す。
 * 例: toExplicitProxyBadge({ state: "crashLoop", restartCount: 5 }) // => { label: "起動失敗を繰り返しています（再起動5回）", tone: "danger" }
 */
function toExplicitProxyBadge(explicitProxy: GatewayStatus["explicitProxy"]): Badge {
  switch (explicitProxy.state) {
    case "active":
      return { label: "稼働中", tone: "ok" };
    case "stopped":
      return { label: "停止", tone: "muted" };
    case "unconfigured":
      return { label: "未構成（許可CIDRが空）", tone: "warn" };
    case "crashLoop":
      return { label: `起動失敗を繰り返しています（再起動${explicitProxy.restartCount}回）`, tone: "danger" };
    case "error":
      return { label: "設定ファイルの生成エラー", tone: "danger" };
  }
}

/**
 * 目的: DNS中継の稼働状況を、表示ラベルと色調（tone）へ変換する。
 * 入力: dnsRelay(APIレスポンスのdnsRelayオブジェクト)。
 * 出力: Badge。待受中でも上流（自宅DNSサーバ）への転送が失敗している間は、名前解決が止まりうるため警告で示す。
 * 例: toDnsRelayBadge({ state: "active", upstream: "failing", bypassEntries: 0 }) // => { label: "自宅DNSサーバに接続できません", tone: "danger" }
 */
function toDnsRelayBadge(dnsRelay: NonNullable<GatewayStatus["dnsRelay"]>): Badge {
  switch (dnsRelay.state) {
    case "active":
      return dnsRelay.upstream === "failing"
        ? { label: "自宅DNSサーバに接続できません", tone: "danger" }
        : { label: "稼働中", tone: "ok" };
    case "stopped":
      return { label: "停止", tone: "muted" };
    case "unconfigured":
      return { label: "未構成（自宅DNSサーバ未設定）", tone: "warn" };
    case "error":
      return { label: "待受に失敗（ポート衝突等）", tone: "danger" };
  }
}

export function GatewayStatusCard({ gateway, gatewayError, isLoading }: Props) {
  // 取得失敗・取得中は両行に共通の表示とし、取得できた場合のみ各機能の実状態を出す。
  // 失敗理由の全文は1行目にだけ出す（同じ文言を2回alertとして読み上げさせないため）。
  function renderRow(renderStatus: (loaded: GatewayStatus) => ReactNode, showErrorDetail: boolean): ReactNode {
    if (gatewayError) {
      return showErrorDetail ? (
        <span className="badge badge-danger" role="alert">
          取得失敗: {gatewayError}
        </span>
      ) : (
        <span className="badge badge-danger">取得失敗</span>
      );
    }
    if (isLoading || !gateway) {
      return <span className="badge badge-muted">取得中...</span>;
    }
    return renderStatus(gateway);
  }

  const transparentGatewayView = renderRow((loaded) => {
    const badge = toBadge(loaded.transparentGateway);
    return (
      <>
        <span className={`badge badge-${badge.tone}`}>{badge.label}</span>
        {loaded.transparentGateway.vpnInterface ? (
          <span className="hint"> VPN IF: {loaded.transparentGateway.vpnInterface}</span>
        ) : loaded.transparentGateway.wanInterface ? (
          <span className="hint"> WAN IF: {loaded.transparentGateway.wanInterface}</span>
        ) : null}
      </>
    );
  }, true);

  const explicitProxyView = renderRow((loaded) => {
    const badge = toExplicitProxyBadge(loaded.explicitProxy);
    const { socksPort, httpPort } = loaded.explicitProxy;
    return (
      <>
        <span className={`badge badge-${badge.tone}`}>{badge.label}</span>
        {socksPort !== undefined && httpPort !== undefined ? (
          <span className="hint"> SOCKS5 :{socksPort} / HTTP :{httpPort}</span>
        ) : null}
      </>
    );
  }, false);

  // 古いゲートウェイ（DNS中継なし）では項目自体を出さない。
  const dnsRelayView = renderRow((loaded) => {
    if (loaded.dnsRelay === undefined) return null;
    const badge = toDnsRelayBadge(loaded.dnsRelay);
    return (
      <>
        <span className={`badge badge-${badge.tone}`}>{badge.label}</span>
        {loaded.dnsRelay.state === "active" ? <span className="hint"> 迂回中のIP: {loaded.dnsRelay.bypassEntries}件</span> : null}
      </>
    );
  }, false);
  const showDnsRelay = gateway?.dnsRelay !== undefined;

  return (
    <div aria-label="稼働状況">
      <dl className="status-list">
        <dt>透過ゲートウェイ</dt>
        {/* dd要素はARIA上アクセシブルネームを付けられないため、テスト（単体・E2E）が機能ごとの行を特定する目的でdata-testidを付ける。 */}
        <dd data-testid="status-transparent-gateway">{transparentGatewayView}</dd>
        <dt>明示的プロキシ</dt>
        <dd data-testid="status-explicit-proxy">{explicitProxyView}</dd>
        {showDnsRelay ? (
          <>
            <dt>DNS中継</dt>
            <dd data-testid="status-dns-relay">{dnsRelayView}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
