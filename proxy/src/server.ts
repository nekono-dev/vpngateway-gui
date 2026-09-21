// 責務: APIコンテナからUDS経由で受信した解決済みコマンドを実行する内部専用HTTPサーバ。
// コンテナ外部（LAN含む）から一切到達不能なUnixドメインソケット上でのみlistenする。
// 正式なAPI（OpenAPI公開対象）ではなく、テキスト化された解決済みコマンドをそのまま実行させるための内部チャネル。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAllowedBinary } from "./allowlist.js";
import { runCommand, runDetachableCommand } from "./exec/command-runner.js";
import { listenOnUnixSocket } from "./lib/socket-bootstrap.js";
import { ensureIpForwardEnabled, isIpForwardEnabled } from "./network/ip-forward.js";
import { GatewayController, type GatewaySettings } from "./network/gateway-controller.js";
import { checkConnectionOnce, startConnectionMonitor } from "./network/connection-monitor.js";
import { ExplicitProxyController } from "./explicit-proxy/explicit-proxy-controller.js";

const SOCKET_PATH = process.env.CTL_SOCKET_PATH ?? "/var/run/vpngw-ctl/exec.sock";
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

// 内部プロトコルのリクエスト形状（OpenAPI非公開）。apiserver/design.md「プロキシとの内部通信仕様」参照。
interface ExecRequestBody {
  vendor: string;
  binary: string;
  resolvedArgv: string[];
  timeoutMs: number;
  // 設定されている場合、プロセスの終了を待たずstdoutがこの正規表現(文字列)に一致した時点で応答し、
  // プロセスはバックグラウンドで実行継続させる（`login`アクション用、command-runner.ts参照）。
  completionPattern?: string;
  // 設定されている場合、子プロセスの標準入力へ書き込んで閉じる（ユーザー名・パスワード入力型のログイン用）。
  // 秘密情報を含みうるため内容はログへ出さない（有無のみ記録する）。completionPatternとは併用できない
  // （その場合は無視する。バックグラウンド継続する`login`はURL提示型のみで入力を要しないため）。
  stdin?: string;
}

// stdinの最大バイト数。想定外の巨大な入力でプロセス・メモリを消費させないための上限
// （パスワード最大512文字＋2FAコード程度で足りる）。
const MAX_STDIN_BYTES = 4096;

/**
 * 目的: unknownな入力(JSONパース結果)がExecRequestBodyの最小要件を満たすかを検証する。
 * 入力: JSON.parse()の戻り値（unknown）。
 * 出力: 形状が正しければ true（TypeScriptの型ガードとしても機能する）。
 * 期待する入力形状: vendor/binaryが非空文字列、resolvedArgvが文字列配列、timeoutMsが正の数値、
 *                completionPatternは省略可能だが指定時は文字列。stdinは省略可能だが指定時は
 *                MAX_STDIN_BYTES以下の文字列。
 */
function isValidExecRequestBody(value: unknown): value is ExecRequestBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.vendor === "string" &&
    body.vendor.length > 0 &&
    typeof body.binary === "string" &&
    body.binary.length > 0 &&
    Array.isArray(body.resolvedArgv) &&
    body.resolvedArgv.every((item) => typeof item === "string") &&
    typeof body.timeoutMs === "number" &&
    body.timeoutMs > 0 &&
    (body.completionPattern === undefined || typeof body.completionPattern === "string") &&
    (body.stdin === undefined || (typeof body.stdin === "string" && Buffer.byteLength(body.stdin, "utf8") <= MAX_STDIN_BYTES))
  );
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(payload);
}

/**
 * 目的: 実行要求・結果を構造化ログとして標準出力へ記録する（監査ログ、apiserver/design.md参照）。
 * 入力: ログに残すイベント種別と付随情報。
 * 出力: なし（副作用としてstdoutへJSON1行を出力）。
 * 副作用: 監査目的のため、成功・失敗を問わず全リクエストを記録する。
 */
function logAuditEvent(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...event }));
}

async function handleExec(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readRequestBody(req));
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  if (!isValidExecRequestBody(parsed)) {
    sendJson(res, 400, { error: "invalid_request_shape" });
    return;
  }

  // 内部防御: APIコンテナが将来侵害・バグ混入した場合でも、任意コマンド実行の踏み台にならないための最後の防波堤。
  if (!isAllowedBinary(parsed.binary)) {
    logAuditEvent({ event: "exec_rejected", reason: "binary_not_allowed", binary: parsed.binary });
    sendJson(res, 403, { error: "binary_not_allowed" });
    return;
  }

  const result = parsed.completionPattern
    ? await runDetachableCommand(parsed.binary, parsed.resolvedArgv, parsed.timeoutMs, parsed.completionPattern, {
        // バックグラウンド継続後の最終的な終了（自然終了・強制kill問わず）を監査ログに残す。
        // 呼び出し元へのレスポンスは既に返却済みのため、ここでは別途ログ出力のみ行う。
        onBackgroundExit: (info) => {
          logAuditEvent({
            event: "background_exec_completed",
            vendor: parsed.vendor,
            binary: parsed.binary,
            argv: parsed.resolvedArgv,
            exitCode: info.exitCode,
            killedByTimeout: info.killedByTimeout,
          });
        },
      })
    : await runCommand(parsed.binary, parsed.resolvedArgv, parsed.timeoutMs, { stdin: parsed.stdin });
  // stdinは秘密情報（パスワード等）を含みうるため、内容は記録せず有無のみ残す。
  logAuditEvent({
    event: "exec_completed",
    vendor: parsed.vendor,
    binary: parsed.binary,
    argv: parsed.resolvedArgv,
    exitCode: result.exitCode,
    ...(parsed.stdin !== undefined ? { stdinProvided: true } : {}),
  });
  sendJson(res, 200, result);

  // connect/disconnect/国変更等、VPN接続状態に影響しうるコマンド実行の直後にゲートウェイルールを
  // 即座に再構成する（監視ループの次回ポーリングを待たない。proxyserver/design.md
  // 「再接続・国変更時の旧ルール撤去→新IFでの再適用処理」参照）。失敗してもレスポンスには影響させない
  // （既にクライアントへ応答済みのため、監視ループが後続のポーリングで追従する）。
  checkConnectionOnce(gatewayController, LAN_IFACE).catch((error: unknown) => {
    logAuditEvent({
      event: "gateway_reconcile_error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
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
  if (req.method === "POST" && req.url === "/exec") {
    handleExec(req, res).catch((error: unknown) => {
      logAuditEvent({ event: "exec_error", message: error instanceof Error ? error.message : String(error) });
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
