// 責務: APIコンテナからプロキシコンテナの内部専用HTTPサーバへ、UDS経由でコマンド実行要求を送信する。
// apiserver/design.md「プロキシとの内部通信仕様」参照。この経路はOpenAPI非公開の内部チャネル。

import { Pool } from "undici";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { GatewayStatusSchema, type GatewayStatus } from "../schemas/gateway.js";
import { ProxyUnavailableError, ProxyTimeoutError } from "../errors.js";

const SOCKET_PATH = process.env.PROXY_SOCKET_PATH ?? "/var/run/vpngw-ctl/exec.sock";

// プロキシは別コンテナ・別プロセスで動くため、TypeScriptの型だけでは実際のレスポンス形状を保証できない
// （バージョン不一致・実装ミス等でプロトコルが乖離する可能性がある）。UDS経由の内部通信とはいえ、
// 誤った形状のレスポンスをそのままExecResultとして扱うと後続処理で不可解な失敗を招くため、実行時に検証する。
const ExecResultSchema = Type.Object({
  exitCode: Type.Union([Type.Number(), Type.Null()]),
  stdout: Type.String(),
  stderr: Type.String(),
});

// Unixドメインソケット経由の接続プール。TCPは使用しない。
const pool = new Pool("http://localhost", { socketPath: SOCKET_PATH });

export interface ExecInput {
  vendor: string;
  binary: string;
  resolvedArgv: string[];
  timeoutMs: number;
  // 設定した場合、プロキシ側はプロセスの終了を待たずstdoutがこの正規表現(文字列)に一致した時点で応答する
  // （`login`アクション用、profile.schema.tsの`ActionDef.completionPattern`参照）。
  completionPattern?: string;
}

export interface ExecResult {
  // null: completionPatternに一致し応答した時点ではプロセスがまだ終了していないことを表す。
  exitCode: number | null;
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
    const body: unknown = await response.body.json();
    if (!Value.Check(ExecResultSchema, body)) {
      const errors = [...Value.Errors(ExecResultSchema, body)].slice(0, 5);
      throw new Error(`unexpected response shape from proxy: ${JSON.stringify(errors)}`);
    }
    return body;
  } catch (error) {
    throw toProxyClientError(error);
  }
}

// レスポンスは`{ applied: boolean }`のみを含む単純な形状。実行系(ExecResultSchema)ほど複雑でないため
// 個別に定義する。
const SettingsResultSchema = Type.Object({
  applied: Type.Boolean(),
});

/**
 * 目的: ユーザ向け設定の最新値をプロキシの`POST /settings`へ通知し、nftables等への実反映を要求する。
 *      `executeVendorCommand`（VPNベンダーCLI実行系）とは別の内部プロトコルのため、最初から関数を分離する
 *      （proxyserver/design.md「内部プロトコル拡張」参照）。
 * 入力: settings(UserSettings全体。プロキシ側が実際に用いるのはkillSwitch/transparentGatewayEnabledのみだが、
 *      将来のPhase 4（explicitProxyEnabled等）に備え全体を送信する)。
 * 出力: プロキシがルール再構成を実際に適用できたか（applied）。
 * 失敗時の方針: executeVendorCommandと同じ分類でProxyUnavailableError/ProxyTimeoutErrorへ変換して投げる
 *              （呼び出し元で502/504にマッピングする）。
 * 例: await notifySettings({ killSwitch: true, transparentGatewayEnabled: true, ... })
 */
export async function notifySettings(settings: Record<string, unknown>): Promise<{ applied: boolean }> {
  try {
    const response = await pool.request({
      path: "/settings",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
      bodyTimeout: 5000,
      headersTimeout: 5000,
    });
    const body: unknown = await response.body.json();
    if (!Value.Check(SettingsResultSchema, body)) {
      const errors = [...Value.Errors(SettingsResultSchema, body)].slice(0, 5);
      throw new Error(`unexpected response shape from proxy: ${JSON.stringify(errors)}`);
    }
    return body;
  } catch (error) {
    throw toProxyClientError(error);
  }
}

/**
 * 目的: プロキシの`GET /status`から透過ゲートウェイ等の実際の稼働状況を取得する（読み取り専用）。
 * 入力: なし。
 * 出力: GatewayStatus（スキーマはschemas/gateway.ts。プロキシのレスポンス形状を実行時に検証する）。
 * 失敗時の方針: 他の内部通信と同じ分類でProxyUnavailableError/ProxyTimeoutErrorへ変換して投げる
 *              （呼び出し元で502/504にマッピングする）。ポーリング用途のため短いタイムアウトとする。
 * 例: const { transparentGateway } = await fetchProxyStatus();
 */
export async function fetchProxyStatus(): Promise<GatewayStatus> {
  try {
    const response = await pool.request({
      path: "/status",
      method: "GET",
      bodyTimeout: 3000,
      headersTimeout: 3000,
    });
    const body: unknown = await response.body.json();
    if (!Value.Check(GatewayStatusSchema, body)) {
      const errors = [...Value.Errors(GatewayStatusSchema, body)].slice(0, 5);
      throw new Error(`unexpected response shape from proxy: ${JSON.stringify(errors)}`);
    }
    return body;
  } catch (error) {
    throw toProxyClientError(error);
  }
}

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
