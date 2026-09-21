// 責務: ネットワークコンテナ（`proxy`）のエントリポイント。透過ゲートウェイ・Kill Switch・明示的プロキシ・
// トンネル検出・接続監視を担い、APIコンテナからUDS経由で設定反映・状態取得・接続状態の再確認を受ける内部専用HTTPサーバ。
// コンテナ外部（LAN含む）から一切到達不能なUnixドメインソケット上でのみlistenする。ベンダーCLIは実行しない
// （Phase 11でランナー`runner.ts`へ分離。specs/proxyserver/design.md「コンテナ構成（Phase 11）」）。
//   POST /settings         : ユーザ向け設定の反映
//   GET  /status           : 稼働状況の取得
//   POST /connection-checks: 接続状態の即時再確認（接続・切断・ベンダー切替の直後にAPIが呼ぶ）

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { logAuditEvent } from "./lib/audit-event.js";
import { readRequestBody, sendJson } from "./lib/http-json.js";
import { listenOnUnixSocket } from "./lib/socket-bootstrap.js";
import { ensureIpForwardEnabled, isIpForwardEnabled } from "./network/ip-forward.js";
import { GatewayController, type GatewaySettings } from "./network/gateway-controller.js";
import { checkConnectionOnce, startConnectionMonitor } from "./network/connection-monitor.js";
import { ExplicitProxyController } from "./explicit-proxy/explicit-proxy-controller.js";

const SOCKET_PATH = process.env.CTL_SOCKET_PATH ?? "/var/run/vpngw-ctl/net.sock";
const SOCKET_MODE = 0o770;

// インストールスクリプトが検出しnetwork.env経由で渡すLAN側インターフェース名（proxyserver/design.md
// 「NAT/FORWARDルール」参照）。未設定（インストールスクリプト未実行環境）の場合、透過ゲートウェイは
// 安全側として構成しない（GatewayController参照）。
const LAN_IFACE = process.env.LAN_IFACE || undefined;
// フェイルオープン時の送出インターフェース名。単一NIC構成が対象ターゲットのため未設定時はLAN_IFACEを流用する。
const WAN_IFACE = process.env.WAN_IFACE || LAN_IFACE;
const CONNECTION_POLL_INTERVAL_MS = Number(process.env.CONNECTION_POLL_INTERVAL_MS ?? 10_000);

// 明示的プロキシ（3proxy）のLAN向け待ち受けポート。HTTPの既定を8080にしないのは、Web UI（webコンテナが
// ホストの8080を公開）と衝突するため。いずれもhostネットワークのためホストのLAN側へ直接bindする。
const EXPLICIT_SOCKS_PORT = Number(process.env.EXPLICIT_SOCKS_PORT ?? 1080);
const EXPLICIT_HTTP_PORT = Number(process.env.EXPLICIT_HTTP_PORT ?? 3128);

const gatewayController = new GatewayController(LAN_IFACE, WAN_IFACE);
const explicitProxyController = new ExplicitProxyController({
  binaryPath: process.env.EXPLICIT_PROXY_BINARY ?? "/usr/local/bin/3proxy",
  configPath: process.env.EXPLICIT_PROXY_CONFIG ?? "/tmp/vpngwgui/3proxy.cfg",
  socksPort: EXPLICIT_SOCKS_PORT,
  httpPort: EXPLICIT_HTTP_PORT,
  onEvent: (event) => logAuditEvent(event),
});

// 内部プロトコルのリクエスト形状（OpenAPI非公開）。apiserver/design.md「設定反映(`/settings`)内部プロトコル」参照。
// APIサーバはユーザ向け設定全体を送信する。プロキシが用いるのはkillSwitch/transparentGatewayEnabled
// （透過ゲートウェイ）とexplicitProxyEnabled/explicitProxyAllowedCidrs（明示的プロキシ）。
// excludedDomainsはPhase 6で参照する。
interface SettingsRequestBody extends GatewaySettings {
  explicitProxyEnabled: boolean;
  explicitProxyAllowedCidrs: string[];
  [key: string]: unknown;
}

/**
 * 目的: unknownな入力(JSONパース結果)がSettingsRequestBodyの最小要件を満たすかを検証する。
 * 入力: JSON.parse()の戻り値（unknown）。
 * 出力: 形状が正しければ true（TypeScriptの型ガードとしても機能する）。
 * 期待する入力形状: killSwitch/transparentGatewayEnabled/explicitProxyEnabledがboolean、
 *                explicitProxyAllowedCidrsが文字列配列。他フィールドは無視する。個々のCIDRの形式は
 *                ここでは検証せず、設定ファイル生成時（config-builder.ts）に検証する。
 */
function isValidSettingsRequestBody(value: unknown): value is SettingsRequestBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.killSwitch === "boolean" &&
    typeof body.transparentGatewayEnabled === "boolean" &&
    typeof body.explicitProxyEnabled === "boolean" &&
    Array.isArray(body.explicitProxyAllowedCidrs) &&
    body.explicitProxyAllowedCidrs.every((cidr) => typeof cidr === "string")
  );
}

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

  if (!isValidSettingsRequestBody(parsed)) {
    sendJson(res, 400, { error: "invalid_request_shape" });
    return;
  }

  const outcome = await gatewayController.applySettings({
    killSwitch: parsed.killSwitch,
    transparentGatewayEnabled: parsed.transparentGatewayEnabled,
  });
  // 明示的プロキシの起動・停止は透過ゲートウェイのnft再構成とは独立して行う。同期的に状態を更新し、
  // プロセスの起動・停止イベントは監査ログへ出力される（ExplicitProxyControllerのonEvent）。
  explicitProxyController.applySettings({
    enabled: parsed.explicitProxyEnabled,
    allowedCidrs: parsed.explicitProxyAllowedCidrs,
  });
  // APIの定期再通知（変更なし）のたびに監査ログが埋まらないよう、実際に再構成した場合のみ記録する。
  if (outcome.reconciled) {
    logAuditEvent({
      event: "settings_applied",
      killSwitch: parsed.killSwitch,
      transparentGatewayEnabled: parsed.transparentGatewayEnabled,
      vpnIface: outcome.vpnIface,
      applied: outcome.applied,
    });
  }
  sendJson(res, 200, { applied: outcome.applied });
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/status") {
    // 副作用なしの読み取り専用。メモリ上の状態のみを返す（proxyserver/design.md「`GET /status`」）。
    sendJson(res, 200, {
      transparentGateway: gatewayController.getStatus(),
      explicitProxy: explicitProxyController.getStatus(),
    });
    return;
  }
  if (req.method === "POST" && req.url === "/connection-checks") {
    handleConnectionCheck(res).catch((error: unknown) => {
      logAuditEvent({ event: "connection_check_error", message: error instanceof Error ? error.message : String(error) });
      sendJson(res, 500, { error: "internal_error" });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/settings") {
    handleSettings(req, res).catch((error: unknown) => {
      logAuditEvent({ event: "settings_error", message: error instanceof Error ? error.message : String(error) });
      sendJson(res, 500, { error: "internal_error" });
    });
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

await listenOnUnixSocket(server, SOCKET_PATH, SOCKET_MODE);
logAuditEvent({ event: "server_started", socketPath: SOCKET_PATH, lanIface: LAN_IFACE, wanIface: WAN_IFACE });
