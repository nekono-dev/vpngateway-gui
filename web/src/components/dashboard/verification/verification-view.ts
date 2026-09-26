// 責務: 設定の動作検証の結果を、画面のグループ表示へ変換する純粋関数群（グループの状態・閉じているときの代表行・件数）。
// 表示規則はwebserver/design.md「設定の動作検証の実装方針」の「グループと折りたたみ」に対応する。

import type { GetV1VerificationsId200, GetV1VerificationsId200ChecksItem } from "../../../generated/api/endpoints.schemas";

export type Verification = GetV1VerificationsId200;
export type VerificationCheck = GetV1VerificationsId200ChecksItem;
export type CheckStatus = VerificationCheck["status"];
export type GroupId = VerificationCheck["group"];

// グループの並び（実行順）と表示名。
export const GROUPS: readonly { id: GroupId; label: string }[] = [
  { id: "config", label: "設定の確認" },
  { id: "gateway", label: "ゲートウェイの通信確認" },
  { id: "client", label: "この端末からの確認" },
];

// 表示上の状態。wait: 待機中 / running: 実行中 / pass: OK / fail: NG / unconfirmed: 未確認。
export type DisplayState = "wait" | "running" | "pass" | "fail" | "unconfirmed";

export const STATE_LABELS: Record<DisplayState, string> = {
  wait: "待機中",
  running: "確認中…",
  pass: "OK",
  fail: "NG",
  unconfirmed: "未確認",
};

export function isFinished(status: CheckStatus): boolean {
  return status === "pass" || status === "fail" || status === "unconfirmed";
}

/** 目的: 項目の状態を表示上の状態へ変換する（対象外は一覧に出さないため待機中扱い）。 */
export function displayStateOf(status: CheckStatus): DisplayState {
  if (status === "running") return "running";
  if (status === "pass" || status === "fail" || status === "unconfirmed") return status;
  return "wait";
}

export interface GroupSummary {
  checks: VerificationCheck[];
  state: DisplayState;
  done: number;
  failCount: number;
  unconfirmedCount: number;
  // 閉じているときに見せる項目（実行中の項目、完了後は最初のNG、なければ最初の未確認）。無ければundefined。
  representative: VerificationCheck | undefined;
}

/**
 * 目的: グループ内の対象の項目から、グループの状態・件数・閉じているときの代表行を求める。
 * 入力: checks(検証の全項目), group(グループ)。
 * 出力: 実行中の項目があれば実行中、全項目が確定していればNGあり→NG・未確認あり→未確認・すべてOK→OK、どれも始まっていなければ待機中。
 *      一部だけ確定して実行中の項目が無い（項目の切り替わりの瞬間）場合も実行中とする。
 */
export function summarizeGroup(checks: readonly VerificationCheck[], group: GroupId): GroupSummary {
  const targets = checks.filter((check) => check.group === group && check.status !== "notApplicable");
  const done = targets.filter((check) => isFinished(check.status)).length;
  const failCount = targets.filter((check) => check.status === "fail").length;
  const unconfirmedCount = targets.filter((check) => check.status === "unconfirmed").length;
  const running = targets.find((check) => check.status === "running");
  let state: DisplayState;
  if (running !== undefined) state = "running";
  else if (targets.length > 0 && done === targets.length) state = failCount > 0 ? "fail" : unconfirmedCount > 0 ? "unconfirmed" : "pass";
  else if (done === 0) state = "wait";
  else state = "running";
  const representative =
    running ??
    (done === targets.length
      ? (targets.find((check) => check.status === "fail") ?? targets.find((check) => check.status === "unconfirmed"))
      : undefined);
  return { checks: targets, state, done, failCount, unconfirmedCount, representative };
}

export interface VerificationTotals {
  total: number;
  done: number;
  pass: number;
  fail: number;
  unconfirmed: number;
}

/** 目的: 対象の項目の件数（全体の進捗バー・結果の要約用）を数える。 */
export function totalsOf(checks: readonly VerificationCheck[]): VerificationTotals {
  const targets = checks.filter((check) => check.status !== "notApplicable");
  const count = (status: CheckStatus): number => targets.filter((check) => check.status === status).length;
  return {
    total: targets.length,
    done: targets.filter((check) => isFinished(check.status)).length,
    pass: count("pass"),
    fail: count("fail"),
    unconfirmed: count("unconfirmed"),
  };
}
