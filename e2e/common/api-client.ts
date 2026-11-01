// 責務: 検証サーバ（導入済みスタック）の API へ、CA を指定して HTTPS で要求を送る共有クライアント。
// hosted（e2e-tests）と vendor-live（vendor-live-e2e）の両方が使う。証明書の検証を無効化する経路は持たない。

import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";

/** 通常の要求のタイムアウト（ミリ秒）。 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * API の応答。HTTP の失敗（http）と、接続・証明書・タイムアウトの失敗（transport）を区別する。
 * 目的: 呼び出し側が「API が応答した失敗」と「API に届かない失敗」を別に扱えるようにする。
 */
export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; kind: "http"; status: number; error: string; message: string }
  | { ok: false; kind: "transport"; message: string; code?: string };

/** API クライアント。パスは baseUrl からの相対パス（例: `/v1/session`）。 */
export interface ApiClient {
  get<T>(path: string, timeoutMs?: number): Promise<ApiResult<T>>;
  post<T>(path: string, body?: unknown, timeoutMs?: number): Promise<ApiResult<T>>;
  put<T>(path: string, body: unknown, timeoutMs?: number): Promise<ApiResult<T>>;
  patch<T>(path: string, body: unknown, timeoutMs?: number): Promise<ApiResult<T>>;
  delete<T>(path: string, timeoutMs?: number): Promise<ApiResult<T>>;
}

/**
 * 目的: `Set-Cookie` の値の配列を、名前と値の対応（Cookie の保持）へ反映する。
 * 入力: jar(保持中の Cookie。名前→値)、setCookie(応答の Set-Cookie ヘッダの値の配列。未指定なら何もしない)。
 * 出力: なし（jar を直接更新する）。Max-Age=0 または Expires が過去の Cookie は削除する。
 * 失敗時の方針: 解釈できない行は無視する（Cookie を保持しないだけで、要求は続行する）。
 * 例: applySetCookie(jar, ["vpngwgui_session=abc; Path=/; HttpOnly"]) // jar は vpngwgui_session=abc を持つ
 */
export function applySetCookie(jar: Map<string, string>, setCookie: readonly string[] | undefined): void {
  if (setCookie === undefined) return;
  for (const line of setCookie) {
    const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const expired = attributes.some((attr) => {
      const lower = attr.toLowerCase();
      if (lower === "max-age=0") return true;
      if (lower.startsWith("expires=")) return Date.parse(attr.slice("expires=".length)) <= Date.now();
      return false;
    });
    if (expired) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

/**
 * 目的: 保持中の Cookie を、Cookie ヘッダの値（`name=value; name2=value2`）へ組み立てる。
 * 入力: jar(保持中の Cookie)。
 * 出力: Cookie ヘッダの値。Cookie が無ければ空文字列。
 * 例: cookieHeader(new Map([["a", "1"]])) // => "a=1"
 */
export function cookieHeader(jar: ReadonlyMap<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * 目的: CA を指定して API へ要求するクライアントを作る。CA ファイルは作成時に読む。
 * 入力: config.baseUrl（例 `https://127.0.0.1:3000`）、config.caPath（API の証明書を発行した CA の PEM ファイル）。
 * 出力: ApiClient。証明書の検証は必ず行う（`rejectUnauthorized: false` は使わない）。
 * 失敗時の方針: CA ファイルが読めなければ例外を投げる（呼び出し側が試験を中止する）。
 * 例: createApiClient({ baseUrl: "https://127.0.0.1:3000", caPath: "/tmp/api-ca.crt" }).get("/v1/session")
 */
export function createApiClient(config: { baseUrl: string; caPath: string }): ApiClient {
  const ca = readFileSync(config.caPath);
  const base = new URL(config.baseUrl);
  const jar = new Map<string, string>();

  const send = <T>(method: string, path: string, body: unknown, timeoutMs: number): Promise<ApiResult<T>> =>
    new Promise((resolve) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const headers: Record<string, string> = { accept: "application/json" };
      const cookies = cookieHeader(jar);
      if (cookies !== "") headers.cookie = cookies;
      if (payload !== undefined) {
        headers["content-type"] = "application/json";
        headers["content-length"] = String(Buffer.byteLength(payload));
      }

      const req = httpsRequest(
        {
          protocol: base.protocol,
          hostname: base.hostname,
          port: base.port === "" ? 443 : Number(base.port),
          path,
          method,
          headers,
          ca,
          // 証明書の検証は既定の true のまま（rejectUnauthorized を指定しない）
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            applySetCookie(jar, res.headers["set-cookie"]);
            const text = Buffer.concat(chunks).toString("utf8");
            const status = res.statusCode ?? 0;
            const parsed: unknown = text === "" ? undefined : safeJson(text);
            if (status >= 200 && status < 300) {
              resolve({ ok: true, status, body: parsed as T });
              return;
            }
            const error = typeof (parsed as { error?: unknown })?.error === "string" ? (parsed as { error: string }).error : "unknown";
            const message = typeof (parsed as { message?: unknown })?.message === "string" ? (parsed as { message: string }).message : text.slice(0, 200);
            resolve({ ok: false, kind: "http", status, error, message });
          });
        },
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`タイムアウト（${timeoutMs} ms）`));
      });
      req.on("error", (err: Error) => {
        // code は TLS の失敗（証明書の検証の失敗など）を区別するために使う
        const code = (err as NodeJS.ErrnoException).code;
        resolve({ ok: false, kind: "transport", message: err.message, ...(code === undefined ? {} : { code }) });
      });
      if (payload !== undefined) req.write(payload);
      req.end();
    });

  return {
    get: <T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS) => send<T>("GET", path, undefined, timeoutMs),
    post: <T>(path: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS) => send<T>("POST", path, body, timeoutMs),
    put: <T>(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS) => send<T>("PUT", path, body, timeoutMs),
    patch: <T>(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS) => send<T>("PATCH", path, body, timeoutMs),
    delete: <T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS) => send<T>("DELETE", path, undefined, timeoutMs),
  };
}

/**
 * 目的: JSON として解釈し、失敗したら生の文字列のまま返す（HTML 等の応答でも例外にしない）。
 * 入力: text(応答の本文)。
 * 出力: 解釈できた値、または元の文字列。
 */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
