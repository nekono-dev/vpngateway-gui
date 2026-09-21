// 責務: ランナーコンテナ（`runner-<ベンダー>`）のエントリポイント。APIコンテナからUDS経由で受信した解決済みコマンドを
// 実行する内部専用HTTPサーバ。コンテナ外部（LAN含む）から一切到達不能なUnixドメインソケット上でのみlistenする。
// 正式なAPI（OpenAPI公開対象）ではなく、テキスト化された解決済みコマンドをそのまま実行させるための内部チャネル。
// ネットワーク制御（nftables・3proxy・接続監視）は持たない（それはネットワークコンテナ`server.ts`の責務。
// specs/proxyserver/design.md「コンテナ構成（Phase 11）」）。
//   POST /exec  : 解決済みコマンドの実行（自ベンダーのバイナリのみ許可。exec/exec-handler.ts）
//   GET  /health: 利用可否の確認（APIの`GET /v1/providers`が使う。CLIは起動しない副作用なしの応答）

import { createServer } from "node:http";
import { getAllowedBinary } from "./allowlist.js";
import { handleExec } from "./exec/exec-handler.js";
import { logAuditEvent } from "./lib/audit-event.js";
import { sendJson } from "./lib/http-json.js";
import { listenOnUnixSocket } from "./lib/socket-bootstrap.js";

const SOCKET_PATH = process.env.CTL_SOCKET_PATH;
const SOCKET_MODE = 0o770;

if (!SOCKET_PATH) {
  throw new Error("CTL_SOCKET_PATH is required for the runner (e.g. /var/run/vpngw-ctl/runner-<vendor-id>.sock)");
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, binary: getAllowedBinary() ?? null });
    return;
  }
  if (req.method === "POST" && req.url === "/exec") {
    handleExec(req, res).catch((error: unknown) => {
      logAuditEvent({ event: "exec_error", message: error instanceof Error ? error.message : String(error) });
      sendJson(res, 500, { error: "internal_error" });
    });
    return;
  }
  sendJson(res, 404, { error: "not_found" });
});

await listenOnUnixSocket(server, SOCKET_PATH, SOCKET_MODE);
logAuditEvent({ event: "runner_started", socketPath: SOCKET_PATH, allowedBinary: getAllowedBinary() ?? null });
