// 責務: APIコンテナからプロキシコンテナの内部専用HTTPサーバへ、UDS経由でコマンド実行要求を送信する。
// apiserver/design.md「プロキシとの内部通信仕様」参照。この経路はOpenAPI非公開の内部チャネル。

import { Pool } from "undici";
import { ProxyUnavailableError, ProxyTimeoutError } from "../errors.js";

const SOCKET_PATH = process.env.PROXY_SOCKET_PATH ?? "/var/run/vpngw-ctl/exec.sock";

// Unixドメインソケット経由の接続プール。TCPは使用しない。
const pool = new Pool("http://localhost", { socketPath: SOCKET_PATH });

export interface ExecInput {
  vendor: string;
  binary: string;
  resolvedArgv: string[];
  timeoutMs: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * 目的: 解決済みコマンドをプロキシの`POST /exec`へ送信し、実行結果を取得する。
 * 入力: input(vendor/binary/resolvedArgv/timeoutMs)。
 * 出力: ExecResult(exitCode/stdout/stderr)。
 * 失敗時の方針: UDS接続失敗（ソケット未起動等）はProxyUnavailableError、
 *              応答タイムアウトはProxyTimeoutErrorへ変換して投げる（呼び出し元で502/504にマッピングする）。
 */
export async function executeVendorCommand(input: ExecInput): Promise<ExecResult> {
  const bodyTimeout = input.timeoutMs + 2000;

  try {
    const response = await pool.request({
      path: "/exec",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      bodyTimeout,
      headersTimeout: bodyTimeout,
    });
    const result = (await response.body.json()) as ExecResult;
    return result;
  } catch (error) {
    throw toProxyClientError(error);
  }
}

// Phase 2でユーザ向け設定変更をプロキシへ通知するnotifySettings()をここに追加する予定。
// 実行系(executeVendorCommand)とは別関数として最初から分離しておく（wbs/phase1.md参照）。

function toProxyClientError(error: unknown): Error {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  if (code === "ENOENT" || code === "ECONNREFUSED" || code === "UND_ERR_SOCKET") {
    return new ProxyUnavailableError("failed to connect to proxy control socket");
  }
  if (code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") {
    return new ProxyTimeoutError("proxy did not respond within timeout");
  }
  return error instanceof Error ? error : new Error(String(error));
}
