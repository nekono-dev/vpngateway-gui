// 責務: APIコンテナからUDS経由で受信した解決済みコマンドを実行する内部専用HTTPサーバ。
// コンテナ外部（LAN含む）から一切到達不能なUnixドメインソケット上でのみlistenする。
// 正式なAPI（OpenAPI公開対象）ではなく、テキスト化された解決済みコマンドをそのまま実行させるための内部チャネル。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAllowedBinary } from "./allowlist.js";
import { runCommand, runDetachableCommand } from "./exec/command-runner.js";
import { listenOnUnixSocket } from "./lib/socket-bootstrap.js";

const SOCKET_PATH = process.env.CTL_SOCKET_PATH ?? "/var/run/vpngw-ctl/exec.sock";
const SOCKET_MODE = 0o770;

// 内部プロトコルのリクエスト形状（OpenAPI非公開）。apiserver/design.md「プロキシとの内部通信仕様」参照。
interface ExecRequestBody {
  vendor: string;
  binary: string;
  resolvedArgv: string[];
  timeoutMs: number;
  // 設定されている場合、プロセスの終了を待たずstdoutがこの正規表現(文字列)に一致した時点で応答し、
  // プロセスはバックグラウンドで実行継続させる（`login`アクション用、command-runner.ts参照）。
  completionPattern?: string;
}

/**
 * 目的: unknownな入力(JSONパース結果)がExecRequestBodyの最小要件を満たすかを検証する。
 * 入力: JSON.parse()の戻り値（unknown）。
 * 出力: 形状が正しければ true（TypeScriptの型ガードとしても機能する）。
 * 期待する入力形状: vendor/binaryが非空文字列、resolvedArgvが文字列配列、timeoutMsが正の数値、
 *                completionPatternは省略可能だが指定時は文字列。
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
    (body.completionPattern === undefined || typeof body.completionPattern === "string")
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
    : await runCommand(parsed.binary, parsed.resolvedArgv, parsed.timeoutMs);
  logAuditEvent({
    event: "exec_completed",
    vendor: parsed.vendor,
    binary: parsed.binary,
    argv: parsed.resolvedArgv,
    exitCode: result.exitCode,
  });
  sendJson(res, 200, result);
}

const server = createServer((req, res) => {
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
logAuditEvent({ event: "server_started", socketPath: SOCKET_PATH });
