// 責務: 単体テスト用の偽の API クライアント（試験の判定を、実機の API なしで確かめるため）。
// 応答は、要求のメソッドとパスから決める関数で与える。実機の資格情報は使わない。

import type { ApiClient, ApiResult } from "../../common/api-client";

/** 要求ごとの応答を決める関数。body は PUT・POST の本文。 */
export type FakeHandler = (method: string, path: string, body?: unknown) => ApiResult<unknown>;

/** 偽の API クライアントを作る。要求は handler に渡され、応答はそのまま返る。 */
export function fakeApi(handler: FakeHandler): ApiClient {
  return {
    get: async <T>(path: string): Promise<ApiResult<T>> => handler("GET", path) as ApiResult<T>,
    post: async <T>(path: string, body?: unknown): Promise<ApiResult<T>> => handler("POST", path, body) as ApiResult<T>,
    put: async <T>(path: string, body: unknown): Promise<ApiResult<T>> => handler("PUT", path, body) as ApiResult<T>,
    patch: async <T>(path: string, body: unknown): Promise<ApiResult<T>> => handler("PATCH", path, body) as ApiResult<T>,
    delete: async <T>(path: string): Promise<ApiResult<T>> => handler("DELETE", path) as ApiResult<T>,
  };
}

/** 成功の応答を作る。 */
export function ok(body: unknown, status = 200): ApiResult<unknown> {
  return { ok: true, status, body };
}

/** HTTP の失敗の応答を作る。 */
export function httpError(status: number, error: string, message = "失敗"): ApiResult<unknown> {
  return { ok: false, kind: "http", status, error, message };
}

/** 通信の失敗の応答を作る。 */
export function transportError(message = "接続できない"): ApiResult<unknown> {
  return { ok: false, kind: "transport", message };
}
