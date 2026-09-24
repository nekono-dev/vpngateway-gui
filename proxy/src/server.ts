// 責務: ネットワークコンテナ（`proxy`）のエントリポイント。透過ゲートウェイ・Kill Switch・明示的プロキシ・
// トンネル検出・接続監視を担い、APIサーバからゲートウェイ制御チャネル（mTLS TCP、既定ポート8443。
// 環境変数GATEWAY_PORT）経由で設定反映・状態取得・接続状態の再確認を受ける内部専用HTTPSサーバ。
// クライアント証明書（requestCert・rejectUnauthorized）でAPIサーバを認証する
// （Phase 25。proxyserver/design.md「ゲートウェイ制御チャネル」。Phase 24までのUDS限定方針からの転換）。
// ベンダーCLIは実行しない（Phase 11でランナー`runner.ts`へ分離）。
//   POST /net/settings         : ユーザ向け設定の反映
//   GET  /net/status           : 稼働状況の取得
//   POST /net/connection-checks: 接続状態の即時再確認（接続・切断・ベンダー切替の直後にAPIが呼ぶ）
//   /runners/<ベンダーID>/*    : 対応するランナーのUDS（runner-<ベンダーID>.sock）へ転送（gateway-channel/runner-forward.ts）

import { createServer as createHttpsServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { logAuditEvent } from "./lib/audit-event.js";
import { readRequestBody, sendJson } from "./lib/http-json.js";
import { loadGatewayTlsOptions } from "./gateway-channel/tls-options.js";
import { matchRunnerPath, forwardToRunner } from "./gateway-channel/runner-forward.js";
import { ensureIpForwardEnabled, isIpForwardEnabled } from "./network/ip-forward.js";
import { GatewayController } from "./network/gateway-controller.js";
import { checkConnectionOnce, startConnectionMonitor } from "./network/connection-monitor.js";
import { getLanIpv4Address, getLanSubnetCidr } from "./network/lan-subnet.js";
import { PolicyRouting } from "./network/policy-routing.js";
import { DnsRelayController } from "./dns-relay/dns-relay-controller.js";
import { parseSettingsRequest, toDnsRelaySettings, toGatewayDnsSettings } from "./settings-request.js";
import { ExplicitProxyController } from "./explicit-proxy/explicit-proxy-controller.js";

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 8443);
// ゲートウェイ機のファイアウォールでAPIサーバのIPへ絞ることを推奨する（多層防御。proxyserver/design.md）。
// アプリ自身は特定インターフェースへ限定せず、mTLSのクライアント証明書検証を主たる境界とする。
const GATEWAY_BIND_HOST = "0.0.0.0";

// インストールスクリプトが検出しnetwork.env経由で渡すLAN側インターフェース名（proxyserver/design.md
// 「NAT/FORWARDルール」参照）。未設定（インストールスクリプト未実行環境）の場合、透過ゲートウェイは
// 安全側として構成しない（GatewayController参照）。
const LAN_IFACE = process.env.LAN_IFACE || undefined;
// フェイルオープン時の送出インターフェース名。単一NIC構成が対象ターゲットのため未設定時はLAN_IFACEを流用する。
const WAN_IFACE = process.env.WAN_IFACE || LAN_IFACE;
const CONNECTION_POLL_INTERVAL_MS = Number(process.env.CONNECTION_POLL_INTERVAL_MS ?? 10_000);

// LAN側のネットワークCIDR（例: 192.168.3.0/24）。起動時に一度だけ検出する（実行中にLAN側のIPアドレスが
// 変わる運用は想定しないため、`GET /status`のたびに`ip`を実行しない）。Web UIの設定ダイアログで、
// 明示的プロキシの許可CIDR欄の初期値として使う（webserver/requirements.md「明示的プロキシの許可CIDRの初期値」）。
const lanCidr = await getLanSubnetCidr(LAN_IFACE);

// 明示的プロキシ（3proxy）のLAN向け待ち受けポート。HTTPの既定を8080にしないのは、Web UI（webコンテナが
// ホストの8080を公開）と衝突するため。いずれもhostネットワークのためホストのLAN側へ直接bindする。
const EXPLICIT_SOCKS_PORT = Number(process.env.EXPLICIT_SOCKS_PORT ?? 1080);
const EXPLICIT_HTTP_PORT = Number(process.env.EXPLICIT_HTTP_PORT ?? 3128);

// DNS中継リゾルバの待受ポート（ホストのDNSと衝突する場合に変更する）。LAN側アドレスと127.0.0.1（3proxy用）で待ち受ける。
const DNS_RELAY_PORT = Number(process.env.DNS_RELAY_PORT ?? 53);
const lanAddress = await getLanIpv4Address(LAN_IFACE);

const gatewayController = new GatewayController(LAN_IFACE, WAN_IFACE, undefined, {
  policyRouting: new PolicyRouting(LAN_IFACE),
  // 3proxyはこのプロセスから起動するため、実行ユーザーが同じ。迂回の対象にするホスト自身の発信の判定に使う。
  explicitProxyUid: process.getuid?.(),
  onEvent: (event) => logAuditEvent(event),
});
const dnsRelayController = new DnsRelayController({
  port: DNS_RELAY_PORT,
  listenAddresses: [...(lanAddress !== undefined ? [lanAddress] : []), "127.0.0.1"],
  // nftのsetへの反映が終わってから、中継リゾルバがクライアントへ応答を返す。
  registerBypass: (addresses) => gatewayController.addBypass(addresses),
  bypassEntryCount: () => gatewayController.bypassEntryCount(),
  onEvent: (event) => logAuditEvent(event),
});
const explicitProxyController = new ExplicitProxyController({
  binaryPath: process.env.EXPLICIT_PROXY_BINARY ?? "/usr/local/bin/3proxy",
  configPath: process.env.EXPLICIT_PROXY_CONFIG ?? "/tmp/vpngwgui/3proxy.cfg",
  socksPort: EXPLICIT_SOCKS_PORT,
  httpPort: EXPLICIT_HTTP_PORT,
  onEvent: (event) => logAuditEvent(event),
});

/**
 * 目的: `POST /connection-checks`を処理する。トンネル検出→ゲートウェイルールの再構成を即時に1回行う
 *      （接続監視ループの次回ポーリングを待たない。proxyserver/design.md「再接続・国変更時の旧ルール撤去→新IFでの再適用処理」）。
 * 入力: res(応答)。ボディは使わない。
 * 出力: なし。`200 { checked: boolean }`を返す。再構成に失敗しても200（checked: false）で、監視ループが追従する。
 * 副作用: 監視ループと同じ再構成（冪等）。失敗は監査ログへ記録する。
 */
async function handleConnectionCheck(res: ServerResponse): Promise<void> {
  try {
    await checkConnectionOnce(gatewayController, LAN_IFACE);
    sendJson(res, 200, { checked: true });
  } catch (error) {
    logAuditEvent({
      event: "gateway_reconcile_error",
      message: error instanceof Error ? error.message : String(error),
    });
    sendJson(res, 200, { checked: false });
  }
}

async function handleSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readRequestBody(req));
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  const body = parseSettingsRequest(parsed);
  if (body === undefined) {
    sendJson(res, 400, { error: "invalid_request_shape" });
    return;
  }

  // 中継リゾルバを先に構成する（53番リダイレクトの宛先・3proxyの名前解決先が待受を前提とするため）。
  // 待受の成否は状態（GET /net/status）で示し、失敗しても設定反映自体は続ける。
  await dnsRelayController.applySettings(toDnsRelaySettings(body));
  // 待受に失敗している間（ポート衝突等）は、名前解決を中継へ向ける設定（53番リダイレクト・3proxyの名前解決先）を
  // 入れない。入れると、中継が応答しないため名前解決が止まる。次回の再通知（10秒周期）で待受を再試行し、回復すれば入る。
  const relayActive = dnsRelayController.getStatus().state === "active";
  const outcome = await gatewayController.applySettings({
    killSwitch: body.killSwitch,
    transparentGatewayEnabled: body.transparentGatewayEnabled,
    dns: toGatewayDnsSettings(body, lanAddress, DNS_RELAY_PORT, relayActive),
  });
  // 明示的プロキシの起動・停止は透過ゲートウェイのnft再構成とは独立して行う。同期的に状態を更新し、
  // プロセスの起動・停止イベントは監査ログへ出力される（ExplicitProxyControllerのonEvent）。
  // 中継リゾルバが待受中なら、3proxyの名前解決も中継リゾルバ（127.0.0.1）へ向ける。
  explicitProxyController.applySettings({
    enabled: body.explicitProxyEnabled,
    allowedCidrs: body.explicitProxyAllowedCidrs,
    nameServer: relayActive ? (DNS_RELAY_PORT === 53 ? "127.0.0.1" : `127.0.0.1:${DNS_RELAY_PORT}`) : undefined,
  });
  // APIの定期再通知（変更なし）のたびに監査ログが埋まらないよう、実際に再構成した場合のみ記録する。
  if (outcome.reconciled) {
    logAuditEvent({
      event: "settings_applied",
      killSwitch: body.killSwitch,
      transparentGatewayEnabled: body.transparentGatewayEnabled,
      dnsRelayEnabled: body.dnsRelayEnabled,
      vpnIface: outcome.vpnIface,
      applied: outcome.applied,
    });
  }
  sendJson(res, 200, { applied: outcome.applied });
}

const server = createHttpsServer(loadGatewayTlsOptions(), (req, res) => {
  if (req.method === "GET" && req.url === "/net/status") {
    // 副作用なしの読み取り専用。メモリ上の状態のみを返す（proxyserver/design.md「`GET /status`」）。
    sendJson(res, 200, {
      transparentGateway: gatewayController.getStatus(),
      explicitProxy: explicitProxyController.getStatus(),
      dnsRelay: dnsRelayController.getStatus(),
      lanCidr,
    });
    return;
  }
  if (req.method === "POST" && req.url === "/net/connection-checks") {
    handleConnectionCheck(res).catch((error: unknown) => {
      logAuditEvent({ event: "connection_check_error", message: error instanceof Error ? error.message : String(error) });
      sendJson(res, 500, { error: "internal_error" });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/net/settings") {
    handleSettings(req, res).catch((error: unknown) => {
      logAuditEvent({ event: "settings_error", message: error instanceof Error ? error.message : String(error) });
      sendJson(res, 500, { error: "internal_error" });
    });
    return;
  }
  const runnerTarget = matchRunnerPath(req.url);
  if (runnerTarget) {
    forwardToRunner(runnerTarget.vendorId, runnerTarget.runnerPath, req, res);
    return;
  }
  sendJson(res, 404, { error: "not_found" });
});

// ホストのIPフォワーディング設定確認・補正（インストールスクリプト未実行環境向けフォールバック）。
// Dockerはコンテナの/proc/sysを読み取り専用でマウントするため、このコンテナからの補正は実際には
// 失敗しうる（実機検証で確認）。補正できなかった場合、透過ゲートウェイはLAN機器の転送に失敗し続けるため、
// 無音にせず監査ログへ警告を残す（install/setup-sysctl.shの実行が本来の解決手段）。
if (await ensureIpForwardEnabled()) {
  logAuditEvent({ event: "ip_forward_enabled_by_fallback" });
} else if (!isIpForwardEnabled()) {
  logAuditEvent({
    event: "ip_forward_disabled",
    message: "net.ipv4.ip_forward=0のまま。ホストでinstall/setup-sysctl.shを実行すること",
  });
}

// 起動時に既存のnftルールを撤去しない（意図的）。ユーザ向け設定はまだ`POST /settings`で通知されておらず
// 現在の設定を知らないため、ここで撤去すると、設定受信までの間Kill Switchが効かずLAN機器の通信が
// VPNを迂回してリークする（実機検証で確認）。既存ルールは最初の`POST /settings`受信時の全撤去→再適用で
// 置き換わり、その際に前回異常終了時の残骸も同時に掃除される。APIサーバが設定を定期的に再通知する
// ため（api/src/server.ts）、この空白期間は最大でその周期に収まる。
startConnectionMonitor(gatewayController, LAN_IFACE, CONNECTION_POLL_INTERVAL_MS);

await new Promise<void>((resolve) => server.listen(GATEWAY_PORT, GATEWAY_BIND_HOST, resolve));
logAuditEvent({ event: "server_started", gatewayPort: GATEWAY_PORT, lanIface: LAN_IFACE, wanIface: WAN_IFACE });
