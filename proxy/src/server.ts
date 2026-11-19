// 責務: Gateway のネットワーク機能と、API専用UDS制御listenerの起動・停止を管理する。
// ベンダーCLIは実行しない（Phase 11でランナー`runner.ts`へ分離）。
//   POST /net/settings         : ユーザ向け設定の反映
//   GET  /net/status           : 稼働状況の取得
//   POST /net/connection-checks: 接続状態の即時再確認（接続・切断・ベンダー切替の直後にAPIが呼ぶ）
//   POST /net/checks           : 設定の動作検証の1項目を実行（L1・L2）
//   POST /net/check-nonces     : 設定の動作検証で使う検証名の登録
//   GET  /net/check-nonces/<名前>: 検証名の受信の記録と、53番リダイレクトで誘導した送信元の数
//   /runners/<ベンダーID>/*    : 対応するランナーのUDS（runner-<ベンダーID>.sock）へ転送（gateway-channel/runner-forward.ts）

import type { IncomingMessage, ServerResponse } from "node:http";
import { logAuditEvent } from "./lib/audit-event.js";
import { readRequestBody, sendJson } from "./lib/http-json.js";
import { handleHostRebootRequest } from "./host-control/host-reboot-handler.js";
import { createGatewayChannelServer } from "./gateway-channel/control-server.js";
import { listenOnGatewaySocket, type GatewaySocketListener } from "./gateway-channel/server.js";
import { matchRunnerPath, forwardToRunner } from "./gateway-channel/runner-forward.js";
import { ensureIpForwardEnabled, isIpForwardEnabled } from "./network/ip-forward.js";
import { GatewayController } from "./network/gateway-controller.js";
import { GatewayGuard } from "./network/gateway-guard.js";
import { installGatewayStopHandlers } from "./network/gateway-stop-guard.js";
import { checkConnectionOnce, startConnectionMonitor } from "./network/connection-monitor.js";
import { getLanIpv4Address, getLanSubnetCidr } from "./network/lan-subnet.js";
import { PolicyRouting } from "./network/policy-routing.js";
import { DnsRelayController } from "./dns-relay/dns-relay-controller.js";
import { SettingsRequestQueue } from "./settings-request-queue.js";
import { createGatewayRequestHandler } from "./gateway-channel/gateway-routes.js";
import { ExplicitProxyController } from "./explicit-proxy/explicit-proxy-controller.js";
import { REDIRECTED_SET_NAME } from "./network/ruleset.js";
import { CheckNonceRegistry } from "./verification/check-nonces.js";
import { parseCheckNonceRequest, parseGatewayCheckRequest } from "./verification/check-request.js";
import { runGatewayCheck } from "./verification/gateway-checks.js";
import { wasJustRedirected } from "./verification/redirect-record.js";
import { createVerificationRuntime, readSetElements } from "./verification/runtime.js";

const GATEWAY_SOCKET_PATH = process.env.GATEWAY_SOCKET_PATH ?? "/run/vpngw-gateway/gateway.sock";

// インストールスクリプトが検出しnetwork.env経由で渡すLAN側インターフェース名。未設定（インストールスクリプト未実行環境）の場合、透過ゲートウェイは
// 安全側として構成しない（GatewayController参照）。
const LAN_IFACE = process.env.LAN_IFACE || undefined;
// フェイルオープン時の送出インターフェース名。単一NIC構成が対象ターゲットのため未設定時はLAN_IFACEを流用する。
const WAN_IFACE = process.env.WAN_IFACE || LAN_IFACE;
const CONNECTION_POLL_INTERVAL_MS = Number(process.env.CONNECTION_POLL_INTERVAL_MS ?? 10_000);

// LAN側のネットワークCIDR（例: 192.168.3.0/24）。起動時に一度だけ検出する（実行中にLAN側のIPアドレスが
// 変わる運用は想定しないため、`GET /status`のたびに`ip`を実行しない）。Web UIの設定ダイアログで、
// 明示的プロキシの許可CIDR欄の初期値として使う。
const lanCidr = await getLanSubnetCidr(LAN_IFACE);

// 明示的プロキシ（3proxy）のLAN向け待ち受けポート。HTTPの既定を8080にしないのは、Web UI（webコンテナが
// ホストの8080を公開）と衝突するため。いずれもhostネットワークのためホストのLAN側へ直接bindする。
const EXPLICIT_SOCKS_PORT = Number(process.env.EXPLICIT_SOCKS_PORT ?? 1080);
const EXPLICIT_HTTP_PORT = Number(process.env.EXPLICIT_HTTP_PORT ?? 3128);

// DNS中継リゾルバの待受ポート（ホストのDNSと衝突する場合に変更する）。LAN側アドレスと127.0.0.1（3proxy用）で待ち受ける。
const DNS_RELAY_PORT = Number(process.env.DNS_RELAY_PORT ?? 53);
const lanAddress = await getLanIpv4Address(LAN_IFACE);
const dnsRelayListenAddresses = [...(lanAddress !== undefined ? [lanAddress] : []), "127.0.0.1"];
// 設定の動作検証の検証名（Web UIの端末のブラウザが解決する使い捨ての名前）の登録と受信の記録。
const checkNonces = new CheckNonceRegistry();
const settingsRequestQueue = new SettingsRequestQueue();

const gatewayGuard = new GatewayGuard(LAN_IFACE ?? "", undefined, {
  listenerAvailable: false,
  onEvent: (event) => logAuditEvent(event),
});
const gatewayController = new GatewayController(LAN_IFACE, WAN_IFACE, undefined, {
  policyRouting: new PolicyRouting(LAN_IFACE),
  // 3proxyはこのプロセスから起動するため、実行ユーザーが同じ。迂回の対象にするホスト自身の発信の判定に使う。
  explicitProxyUid: process.getuid?.(),
  onEvent: (event) => logAuditEvent(event),
  onReconcileResult: ({ ok, error }) => gatewayGuard.handleGatewayReconcileResult(ok, error),
});
const dnsRelayController = new DnsRelayController({
  port: DNS_RELAY_PORT,
  listenAddresses: dnsRelayListenAddresses,
  // nftのsetへの反映が終わってから、中継リゾルバがクライアントへ応答を返す。
  registerBypass: (addresses) => gatewayController.addBypass(addresses),
  bypassEntryCount: () => gatewayController.bypassEntryCount(),
  onEvent: (event) => logAuditEvent(event),
  // 登録済みの検証名は、上流へ転送せずに応答し、受信と「53番リダイレクトで誘導されたか」を記録する。
  interceptQuery: async (name, clientIp) => {
    if (!checkNonces.has(name)) return false;
    const redirected = wasJustRedirected((await readSetElements(REDIRECTED_SET_NAME)) ?? [], clientIp);
    checkNonces.markReceived(name, redirected);
    return true;
  },
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
 *      （接続監視ループの次回ポーリングを待たない）。
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

const verificationRuntime = createVerificationRuntime({
  gatewayController,
  dnsRelayController,
  explicitProxyController,
  dnsRelayPort: DNS_RELAY_PORT,
  dnsRelayListenAddresses,
  lanAddress,
});
// 設定の動作検証は同時に1項目だけ実行する（APIサーバ側の排他に加えた保険）。
let checkRunning = false;

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  try {
    return JSON.parse(await readRequestBody(req));
  } catch {
    return undefined;
  }
}

/**
 * 目的: `POST /net/checks`を処理する。設定の動作検証の1項目（L1・L2）を実行して結果を返す。
 * 入力: req(ボディ: 項目ID・IP確認サービスのURL等), res(応答)。
 * 出力: なし。`200 { id, status, expected?, observed?, hint?, reason?, value? }`、形式不正は400、実行中は409。
 * 副作用: ゲートウェイの設定・状態は変更しない（読み取りと、検証用の問い合わせ・通信のみ）。
 */
async function handleCheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const request = parseGatewayCheckRequest(await readJsonBody(req));
  if (request === undefined) {
    sendJson(res, 400, { error: "invalid_request_shape" });
    return;
  }
  if (checkRunning) {
    sendJson(res, 409, { error: "check_running" });
    return;
  }
  checkRunning = true;
  try {
    const outcome = await runGatewayCheck(request, verificationRuntime);
    sendJson(res, 200, { id: request.check, ...outcome });
  } finally {
    checkRunning = false;
  }
}

async function handleCheckNonceRegistration(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const request = parseCheckNonceRequest(await readJsonBody(req));
  if (request === undefined) {
    sendJson(res, 400, { error: "invalid_request_shape" });
    return;
  }
  checkNonces.register(request.name, request.ttlSeconds);
  sendJson(res, 200, { registered: true });
}

/**
 * 目的: `GET /net/check-nonces/<名前>`を処理する。検証名の受信の記録と、53番リダイレクトで誘導した送信元の数を返す。
 * 出力: `200 { received, redirected, recentRedirectedClients }`。未登録・期限切れの名前は404。
 */
async function handleCheckNonceRecord(name: string, res: ServerResponse): Promise<void> {
  const record = checkNonces.get(name);
  if (record === undefined) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  const redirectedClients = (await readSetElements(REDIRECTED_SET_NAME)) ?? [];
  sendJson(res, 200, { ...record, recentRedirectedClients: redirectedClients.length });
}

const handleGatewayRequest = createGatewayRequestHandler({
  gatewayController,
  gatewayGuard,
  dnsRelayController,
  explicitProxyController,
  settingsRequestQueue,
  lanAddress,
  lanCidr,
  dnsRelayPort: DNS_RELAY_PORT,
  logAuditEvent,
}, (req, res) => {
  if (req.method === "POST" && req.url === "/net/connection-checks") {
    handleConnectionCheck(res).catch((error: unknown) => {
      logAuditEvent({ event: "connection_check_error", message: error instanceof Error ? error.message : String(error) });
      sendJson(res, 500, { error: "internal_error" });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/net/host-reboot") {
    // ホストの再起動依頼。依頼ファイルを置くだけで、実行はホスト側のsystemdが行う（host-control/host-reboot.ts）。
    handleHostRebootRequest(req, res, (result) => logAuditEvent({ event: "host_reboot_requested", result }));
    return;
  }
  if (req.method === "POST" && req.url === "/net/checks") {
    handleCheck(req, res).catch((error: unknown) => {
      logAuditEvent({ event: "check_error", message: error instanceof Error ? error.message : String(error) });
      sendJson(res, 500, { error: "internal_error" });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/net/check-nonces") {
    handleCheckNonceRegistration(req, res).catch(() => sendJson(res, 500, { error: "internal_error" }));
    return;
  }
  const nonceMatch = req.method === "GET" ? /^\/net\/check-nonces\/([a-z0-9.-]{1,253})$/.exec(req.url ?? "") : null;
  if (nonceMatch !== null) {
    handleCheckNonceRecord(nonceMatch[1], res).catch(() => sendJson(res, 500, { error: "internal_error" }));
    return;
  }
  const runnerTarget = matchRunnerPath(req.url);
  if (runnerTarget) {
    forwardToRunner(runnerTarget.vendorId, runnerTarget.runnerPath, req, res);
    return;
  }
  sendJson(res, 404, { error: "not_found" });
  return true;
});

// Gateway 制御は UDS だけで受け付ける。TLS OFF はHTTP、ON は必須client証明書検証付きmTLS。
const gatewaySocketServer = createGatewayChannelServer(handleGatewayRequest);

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
const stopConnectionMonitor = startConnectionMonitor(gatewayController, LAN_IFACE, CONNECTION_POLL_INTERVAL_MS);

const gatewaySocketListener: GatewaySocketListener = await listenOnGatewaySocket(
  gatewaySocketServer,
  GATEWAY_SOCKET_PATH,
  10001,
  {
    onUnavailable: (reason) => {
      logAuditEvent({ event: "gateway_control_listener_unavailable", reason });
      gatewayGuard.setListenerAvailable(false);
      // UDS listener は自動再 bind せず、lease 更新を止めて Compose の再起動へ委ねる。
      process.exit(1);
    },
  },
);
gatewayGuard.setListenerAvailable(true);
logAuditEvent({ event: "server_started", gatewaySocketPath: GATEWAY_SOCKET_PATH, lanIface: LAN_IFACE, wanIface: WAN_IFACE });

installGatewayStopHandlers({
  signals: process,
  beginShutdown: () => gatewayGuard.beginShutdown(),
  expireLease: () => gatewayGuard.expireLeaseForShutdown(),
  stopControllers: [
    () => stopConnectionMonitor(),
    () => explicitProxyController.stop(),
    () => dnsRelayController.stop(),
  ],
  close: async () => {
    gatewayGuard.close();
    await gatewaySocketListener.close();
  },
  exit: (code) => process.exit(code),
  onError: (error) => logAuditEvent({
    event: "gateway_shutdown_error",
    message: error instanceof Error ? error.message : String(error),
  }),
});
