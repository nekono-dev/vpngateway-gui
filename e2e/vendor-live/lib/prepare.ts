// 責務: 準備処理（API の到達と CA の検証、管理者の認証、基準の公開 IP、ベンダーの認証）を段の順に実行する（要件 1.1〜1.11）。
// 段が失敗したら、以降の段を実行せずに中止する。資格情報は端末の入力からその場で使い、保持しない。

import { createApiClient, type ApiClient, type ApiResult } from "../../common/api-client";
import type { LiveConfig } from "./config";
import { prepareAdGuard } from "./vendors/adguard";
import { prepareProton } from "./vendors/proton";
import type { AbortReason, LiveSession, PrepareIo, PrepareOutcome, VendorSessionState } from "./prepare-types";

/** TLS の証明書の検証に失敗したときの Node のエラーコード（CA が違う・信頼されない）。 */
const CERT_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/**
 * 目的: 通信の失敗を、証明書の失敗（ca-untrusted）と到達の失敗（api-unreachable）に分類する。
 * 入力: result(API の応答。transport の失敗のみ分類する)。
 * 出力: 中止の理由。
 * 例: classifyTransport({ ok: false, kind: "transport", message: "...", code: "DEPTH_ZERO_SELF_SIGNED_CERT" }) // => { kind: "ca-untrusted" }
 */
export function classifyTransport(result: { ok: false; kind: "transport"; code?: string }): AbortReason {
  const cert = result.code !== undefined && (CERT_ERROR_CODES.has(result.code) || result.code.startsWith("CERT_"));
  return cert ? { kind: "ca-untrusted" } : { kind: "api-unreachable" };
}

/**
 * 目的: API の到達と CA の検証を確かめる（資格情報の入力より前に行う。要件 1.1・1.7）。
 * 入力: config(検証サーバの URL と CA)、io(表示のみ使う)。
 * 出力: 到達できれば ApiClient。
 * 失敗時の方針: 証明書の検証が失敗したら ca-untrusted、届かなければ api-unreachable で中止する。
 */
export async function probeApi(config: LiveConfig): Promise<{ ok: true; api: ApiClient } | { ok: false; reason: AbortReason }> {
  let api: ApiClient;
  try {
    api = createApiClient({ baseUrl: config.apiBaseUrl, caPath: config.caPath });
  } catch {
    // 取り込んだ CA を読めない（無い・壊れている）なら、証明書を検証できないので中止する（資格情報は求めない）
    return { ok: false, reason: { kind: "ca-untrusted" } };
  }
  // 未ログインで許可された経路（GET /v1/operator）で到達を確かめる
  const result: ApiResult<unknown> = await api.get("/v1/operator");
  if (result.ok || result.kind === "http") return { ok: true, api };
  return { ok: false, reason: classifyTransport(result) };
}

/** 管理者の認証に使う依存（テストでは差し替える）。 */
export interface OperatorDeps {
  readonly io: PrepareIo;
}

/**
 * 目的: 管理者のユーザー名とパスワードを端末で入力させ、API にログインする（要件 1.9・1.10）。
 * 入力: api(Cookie を保持する)、io(入力と表示)。
 * 出力: 成功なら true。失敗なら operator-auth-failed または api-unreachable。
 * 失敗時の方針: 認証の失敗は直ちに中止する。パスワードは表示も保存もしない。
 */
export async function loginOperator(api: ApiClient, io: PrepareIo): Promise<{ ok: true } | { ok: false; reason: AbortReason }> {
  const username = await io.hidden("管理者のユーザー名: ");
  const password = await io.hidden("管理者のパスワード: ");
  const result = await api.post("/v1/operator/session", { username, password });
  if (result.ok) return { ok: true };
  if (result.kind === "transport") return { ok: false, reason: classifyTransport(result) };
  // API の message（「username or password is incorrect」「too many failed attempts」など）は秘密を含まないので、そのまま示す
  return { ok: false, reason: { kind: "operator-auth-failed", message: `HTTP ${result.status} ${result.message}` } };
}

/** 段の依存。 */
export interface PrepareDeps {
  readonly io: PrepareIo;
  readonly fetchPublicIp: () => Promise<string>;
  readonly now: () => Date;
}

/**
 * 目的: 準備処理を段の順に実行する（API・管理者・基準の IP・ベンダー）。
 * 入力: config、vendor（"protonvpn" または "adguardvpn"）、deps。
 * 出力: 成功なら LiveSession、失敗なら失敗の段と理由。
 * 失敗時の方針: 失敗した段で止め、以降の段を実行しない。
 */
export async function prepare(config: LiveConfig, vendor: VendorSessionState["vendor"], deps: PrepareDeps): Promise<PrepareOutcome> {
  const reached = await probeApi(config);
  if (!reached.ok) return { ok: false, step: "api", reason: reached.reason };

  const operator = await loginOperator(reached.api, deps.io);
  if (!operator.ok) return { ok: false, step: "operator", reason: operator.reason };

  let publicIp: string;
  try {
    publicIp = await deps.fetchPublicIp();
  } catch {
    return { ok: false, step: "public-ip", reason: { kind: "public-ip-unavailable" } };
  }
  deps.io.print(`開発サーバの公開 IP（接続前の基準）: ${publicIp}`);
  const confirmed = await deps.io.visible("検証サーバと同じ回線（同じ公開 IP）か確認し、y で続行: ");
  if (confirmed.trim().toLowerCase() !== "y") {
    return { ok: false, step: "public-ip", reason: { kind: "public-ip-not-confirmed" } };
  }
  const baseline = { publicIp, measuredAt: deps.now().toISOString() };

  const login = vendor === "protonvpn" ? await prepareProton(reached.api, deps.io) : await prepareAdGuard(reached.api, deps.io);
  if (!login.ok) return { ok: false, step: "vendor", reason: login.reason };

  const session: LiveSession = { api: reached.api, baseline, vendor: login.state };
  return { ok: true, session };
}
