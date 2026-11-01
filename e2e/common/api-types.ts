// 責務: 両 spec が使う API 応答の型。api/openapi.json（export-openapi の生成物）の該当スキーマと一致させる（api-types.test.ts で確かめる）。
// 使う経路だけを定義する。製品の API の型をそのまま複製しない（使わない項目は含めない）。

/** GET /v1/operator/session（管理者のログイン状態）。 */
export interface OperatorSessionState {
  readonly authenticated: boolean;
}

/** GET /v1/session（ベンダーのログイン状態とプラン）。 */
export interface VendorSessionState {
  readonly loginMethod: "deviceUrl" | "credentials";
  readonly loggedIn?: boolean;
  readonly plan?: { readonly id: string; readonly label: string; readonly usageNote?: string };
}

/** POST /v1/session（ログインの開始。device 認証では承認の URL を返す）。 */
export interface VendorSessionStarted {
  readonly loginUrl?: string;
  readonly message: string;
}

/** GET /v1/connection/config のうち、試験が読む・戻す項目。 */
export interface ConnectionConfigSubset {
  readonly transparentGatewayEnabled: boolean;
  readonly explicitProxyEnabled: boolean;
}

/** GET /v1/connection。 */
export interface ConnectionState {
  readonly status: "connected" | "disconnected";
  readonly country?: string;
  readonly location?: string;
  readonly locationId?: string;
}

/** 動作検証の項目（GET /v1/verifications/:id の checks の要素）。 */
export interface VerificationCheck {
  readonly id: string;
  readonly title: string;
  readonly group: "config" | "gateway" | "client";
  readonly status: "pending" | "running" | "pass" | "fail" | "unconfirmed" | "notApplicable";
  readonly expected?: string;
  readonly observed?: string;
  readonly hint?: string;
  readonly reason?: string;
}

/** POST /v1/verifications（202）と GET /v1/verifications/:id の応答。 */
export interface Verification {
  readonly id: string;
  readonly state: "running" | "completed";
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly checks: readonly VerificationCheck[];
}

/**
 * 試験が使う経路と応答の項目。api-types.test.ts が、この一覧と openapi.json の応答スキーマを突き合わせる。
 * 項目名を変えたら、この一覧と型の両方を更新する。
 */
export const CONTRACT_FIELDS = [
  { method: "get", path: "/v1/operator/session", status: "200", keys: ["authenticated"] },
  { method: "get", path: "/v1/session", status: "200", keys: ["loginMethod", "loggedIn", "plan"] },
  { method: "post", path: "/v1/session", status: "200", keys: ["loginUrl", "message"] },
  { method: "get", path: "/v1/connection/config", status: "200", keys: ["transparentGatewayEnabled", "explicitProxyEnabled"] },
  { method: "get", path: "/v1/connection", status: "200", keys: ["status", "location", "locationId"] },
  { method: "post", path: "/v1/verifications", status: "202", keys: ["id", "state", "startedAt", "checks"] },
  { method: "get", path: "/v1/verifications/{id}", status: "200", keys: ["id", "state", "checks", "finishedAt"] },
] as const;
