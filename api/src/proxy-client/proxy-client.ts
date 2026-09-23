// 責務: APIコンテナから、ゲートウェイ（`proxy`が単一の窓口として公開するmTLS TCP、既定ポート8443・
// 環境変数GATEWAY_PORT）へ、ベンダー別のランナー宛（コマンド実行・利用可否）とネットワークコンテナ宛
// （設定反映・稼働状況・接続状態の再確認）の要求を送信する。apiserver/design.md「内部プロトコルの変更」
// 「ゲートウェイとの内部通信仕様」参照。この経路はOpenAPI非公開の内部チャネル。
// Phase 25で、Phase 11以来のUDS（`ctl-socket`ボリューム上の`net.sock`・`runner-<ベンダーID>.sock`）を廃止し、
// mTLS TCP（`undici`の`Agent({ connect: { ca, cert, key } })`）へ変更した。ゲートウェイ1台に対し1つの
// HTTP/1.1 keep-alive接続プールを共有し、ベンダーごとの個別プールは持たない（パスでランナーを識別する）。

import { Agent } from "undici";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { GatewayStatusSchema, type GatewayStatus } from "../schemas/gateway.js";
import { ProxyUnavailableError, ProxyTimeoutError } from "../errors.js";
import { loadGatewayClientTlsOptions } from "./gateway-tls-options.js";

const GATEWAY_HOST = process.env.GATEWAY_HOST ?? "127.0.0.1";
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 8443);
const GATEWAY_ORIGIN = `https://${GATEWAY_HOST}:${GATEWAY_PORT}`;

// プロキシは別コンテナ・別プロセスで動くため、TypeScriptの型だけでは実際のレスポンス形状を保証できない
// （バージョン不一致・実装ミス等でプロトコルが乖離する可能性がある）。mTLS TCP経由の内部通信とはいえ、
// 誤った形状のレスポンスをそのままExecResultとして扱うと後続処理で不可解な失敗を招くため、実行時に検証する。
const ExecResultSchema = Type.Object({
  exitCode: Type.Union([Type.Number(), Type.Null()]),
  stdout: Type.String(),
  stderr: Type.String(),
});

// 証明書ファイルの読み込みは、モジュール読み込み時ではなく初回リクエスト時まで遅延させる（証明書未配置の
// 環境でもモジュール自体は読み込めるようにするため。失敗時はProxyUnavailableError等へ変換される呼び出し元の
// try/catchが自然に効く）。
let gatewayAgent: Agent | undefined;
function getGatewayAgent(): Agent {
  if (!gatewayAgent) {
    gatewayAgent = new Agent({ connect: loadGatewayClientTlsOptions() });
  }
  return gatewayAgent;
}

export interface ExecInput {
  vendor: string;
  binary: string;
  resolvedArgv: string[];
  timeoutMs: number;
  // 設定した場合、プロキシ側はプロセスの終了を待たずstdoutがこの正規表現(文字列)に一致した時点で応答する
  // （`login`アクション用、profile.schema.tsの`ActionDef.completionPattern`参照）。
  completionPattern?: string;
  // 設定した場合、プロキシ側は子プロセスの標準入力へ書き込んで閉じる（ユーザー名・パスワード入力型のログイン用）。
  // パスワード等の秘密情報を含みうるため、この値をログ・エラー応答へ出してはならない。
  stdin?: string;
}

export interface ExecResult {
  // null: completionPatternに一致し応答した時点ではプロセスがまだ終了していないことを表す。
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * 目的: 解決済みコマンドを、そのベンダーのランナーの`/runners/<ID>/exec`へ送信し、実行結果を取得する
 *      （`proxy`が対応する`runner-<ID>.sock`へUDS転送する）。
 * 入力: providerId(実行先のベンダーID), input(vendor/binary/resolvedArgv/timeoutMs)。
 * 出力: ExecResult(exitCode/stdout/stderr)。
 * 失敗時の方針: ゲートウェイへの接続失敗（証明書未配置・未起動等）はProxyUnavailableError、
 *              応答タイムアウトはProxyTimeoutErrorへ変換して投げる（呼び出し元で502/504にマッピングする）。
 */
export async function executeVendorCommand(providerId: string, input: ExecInput): Promise<ExecResult> {
  const bodyTimeout = input.timeoutMs + 2000;

  try {
    const response = await getGatewayAgent().request({
      origin: GATEWAY_ORIGIN,
      path: `/runners/${providerId}/exec`,
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
 * 目的: ユーザ向け設定の最新値をネットワークコンテナの`/net/settings`へ通知し、nftables等への実反映を要求する。
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
    const response = await getGatewayAgent().request({
      origin: GATEWAY_ORIGIN,
      path: "/net/settings",
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
 * 目的: ネットワークコンテナの`/net/status`から透過ゲートウェイ等の実際の稼働状況を取得する（読み取り専用）。
 * 入力: なし。
 * 出力: GatewayStatus（スキーマはschemas/gateway.ts。プロキシのレスポンス形状を実行時に検証する）。
 * 失敗時の方針: 他の内部通信と同じ分類でProxyUnavailableError/ProxyTimeoutErrorへ変換して投げる
 *              （呼び出し元で502/504にマッピングする）。ポーリング用途のため短いタイムアウトとする。
 * 例: const { transparentGateway } = await fetchProxyStatus();
 */
export async function fetchProxyStatus(): Promise<GatewayStatus> {
  try {
    const response = await getGatewayAgent().request({
      origin: GATEWAY_ORIGIN,
      path: "/net/status",
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

/**
 * 目的: ベンダーのランナーが応答するか（利用可能か）を、`/runners/<ID>/health`で確認する。
 * 入力: providerId(確認するベンダーID)。
 * 出力: 200で応答すればtrue。ソケットが無い・接続拒否・タイムアウト・証明書未配置・想定外の応答はfalse
 *      （例外にしない）。
 * 副作用: なし（ランナー内でCLIは起動されない）。一覧表示を遅くしないよう短いタイムアウトにする。
 * 例: await checkRunnerHealth("vendorb") // => false（ランナー未起動）
 */
export async function checkRunnerHealth(providerId: string): Promise<boolean> {
  try {
    const response = await getGatewayAgent().request({
      origin: GATEWAY_ORIGIN,
      path: `/runners/${providerId}/health`,
      method: "GET",
      bodyTimeout: 2000,
      headersTimeout: 2000,
    });
    await response.body.dump();
    return response.statusCode === 200;
  } catch {
    return false;
  }
}

/**
 * 目的: ネットワークコンテナへ、接続状態の即時再確認（トンネル検出→ゲートウェイルールの再構成）を依頼する
 *      （`/net/connection-checks`）。接続・切断・ログアウトの実行後と、ベンダー切替後に呼ぶ。
 * 入力: なし。
 * 出力: 再確認できたか（`checked`）。
 * 失敗時の方針: 通信失敗・タイムアウト・想定外の応答は例外にせずfalseを返す（ルールの反映は接続監視ループが
 *              いずれ追従するため、操作の成否には影響させない）。
 */
export async function requestConnectionCheck(): Promise<boolean> {
  try {
    const response = await getGatewayAgent().request({
      origin: GATEWAY_ORIGIN,
      path: "/net/connection-checks",
      method: "POST",
      bodyTimeout: 5000,
      headersTimeout: 5000,
    });
    const body: unknown = await response.body.json();
    return typeof body === "object" && body !== null && (body as Record<string, unknown>).checked === true;
  } catch {
    return false;
  }
}

function toProxyClientError(error: unknown): Error {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  if (code === "ENOENT" || code === "ECONNREFUSED" || code === "UND_ERR_SOCKET" || code === "EPROTO" || code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return new ProxyUnavailableError("failed to connect to gateway control channel");
  }
  if (code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") {
    return new ProxyTimeoutError("proxy did not respond within timeout");
  }
  return error instanceof Error ? error : new Error(String(error));
}
