// 責務: 設定の動作検証の1項目の結果の型と、検証項目のID（APIサーバとの内部プロトコル`POST /net/checks`の契約）。
// 項目の一覧・判定はapiserver/design.md「設定の動作検証」、ゲートウェイ側の実装はproxyserver/design.md「設定の動作検証」。

// ゲートウェイ（L1: 構成の照合、L2: ゲートウェイ内での通信・名前解決）で実行する検証項目。
export const GATEWAY_CHECK_IDS = [
  "gateway-rules",
  "kill-switch-rules",
  "dns-relay-listening",
  "dns-redirect-rules",
  "explicit-proxy-listening",
  "tunnel-egress",
  "dns-relay-resolve",
  "bypass-set",
  "bypass-routing",
  "bypass-isolation",
  "explicit-proxy-egress",
] as const;
export type GatewayCheckId = (typeof GATEWAY_CHECK_IDS)[number];

// pass: 合格 / fail: 不合格 / unconfirmed: 前提を満たさない等で判定できない（不合格とは区別する）。
export type CheckStatus = "pass" | "fail" | "unconfirmed";

export interface CheckOutcome {
  status: CheckStatus;
  // 期待した状態・観測した状態・対処の手がかり（利用者向けの文言。Web UIがそのまま表示する）。
  expected?: string;
  observed?: string;
  hint?: string;
  // unconfirmedの理由（利用者向けの文言）。
  reason?: string;
  // 後続の項目が使う値（出口IP・迂回対象のIP）。
  value?: string;
}

export function pass(observed: string, value?: string): CheckOutcome {
  return { status: "pass", observed, ...(value === undefined ? {} : { value }) };
}

export function fail(expected: string, observed: string, hint: string): CheckOutcome {
  return { status: "fail", expected, observed, hint };
}

export function unconfirmed(reason: string, hint?: string): CheckOutcome {
  return { status: "unconfirmed", reason, ...(hint === undefined ? {} : { hint }) };
}
