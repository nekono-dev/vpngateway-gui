// 責務: 出口 IP の観測。動作検証を実行し、完了後に tunnel-egress の観測値を読んで区分に分類する（要件 4.2・4.3）。

import type { ApiClient } from "../../common/api-client";

/** 動作検証の項目（API の VerificationCheck のうち、本ツールが読む部分）。 */
export interface CheckLike {
  readonly id: string;
  readonly status: "pending" | "running" | "pass" | "fail" | "unconfirmed" | "notApplicable";
  readonly observed?: string;
  readonly reason?: string;
}

/** 動作検証（API の Verification のうち、本ツールが読む部分）。 */
export interface VerificationLike {
  readonly id: string;
  readonly state: "running" | "completed";
  readonly checks: readonly CheckLike[];
}

/** tunnel-egress の観測値の区分。unconfirmed は要件 4.3（切断中）の判定に使う。 */
export type EgressObservation =
  | { kind: "observed"; ip: string }
  | { kind: "unconfirmed"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "not-applicable" };

const IPV4 = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;

/**
 * 目的: 動作検証の項目 tunnel-egress を、観測値の区分へ分類する。
 * 入力: check(tunnel-egress の項目。無ければ undefined)。
 * 出力: EgressObservation。pass で IPv4 が読めた場合だけ observed とする。
 * 失敗時の方針: 判定できない状態（項目が無い・未完了・想定外の値）は failed として理由を返す（合格にしない）。
 * 例: classifyTunnelEgress({ id: "tunnel-egress", status: "unconfirmed", reason: "切断中" }) // => { kind: "unconfirmed", reason: "切断中" }
 */
export function classifyTunnelEgress(check: CheckLike | undefined): EgressObservation {
  if (check === undefined) return { kind: "failed", reason: "tunnel-egress の項目が結果に無い" };
  switch (check.status) {
    case "pass": {
      const ip = IPV4.exec(check.observed ?? "")?.[1];
      return ip === undefined ? { kind: "failed", reason: "tunnel-egress の観測値に IPv4 が無い" } : { kind: "observed", ip };
    }
    case "unconfirmed":
      return { kind: "unconfirmed", reason: check.reason ?? "未確認" };
    case "notApplicable":
      return { kind: "not-applicable" };
    case "fail":
      return { kind: "failed", reason: check.reason ?? check.observed ?? "tunnel-egress が不合格" };
    case "pending":
    case "running":
      return { kind: "failed", reason: "tunnel-egress が完了していない" };
  }
}

/** 検証の上限と間隔（要件 4.2 の設計値）。 */
const OBSERVE_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;

/**
 * 目的: 動作検証を実行し、完了後に tunnel-egress の観測値を読む。
 * 入力: api(管理者の Cookie を保持する API クライアント)、sleep(待機。試験では実時間、単体テストでは差し替え可能)。
 * 出力: EgressObservation。
 * 失敗時の方針: 検証の同時実行（409）は待って再試行する。上限（180 秒）を過ぎたら failed とする。
 */
export async function observeEgress(
  api: ApiClient,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<EgressObservation> {
  const deadline = Date.now() + OBSERVE_TIMEOUT_MS;

  let started: VerificationLike | undefined;
  while (started === undefined) {
    const result = await api.post<VerificationLike>("/v1/verifications");
    if (result.ok) {
      started = result.body;
    } else if (result.kind === "http" && result.status === 409 && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
    } else {
      return { kind: "failed", reason: `検証の開始に失敗（${describe(result)}）` };
    }
  }

  let current: VerificationLike = started;
  while (current.state !== "completed") {
    if (Date.now() >= deadline) return { kind: "failed", reason: "検証が 180 秒以内に完了しなかった" };
    await sleep(POLL_INTERVAL_MS);
    const result = await api.get<VerificationLike>(`/v1/verifications/${started.id}`);
    if (!result.ok) return { kind: "failed", reason: `検証の状態の取得に失敗（${describe(result)}）` };
    current = result.body;
  }

  return classifyTunnelEgress(current.checks.find((check) => check.id === "tunnel-egress"));
}

/**
 * 目的: 失敗した要求の理由を、端末に表示できる短い文言にする（秘密を含まない API の message のみを使う）。
 */
function describe(result: { ok: false; kind: "http"; status: number; message: string } | { ok: false; kind: "transport"; message: string }): string {
  return result.kind === "http" ? `HTTP ${result.status}: ${result.message}` : `通信: ${result.message}`;
}
