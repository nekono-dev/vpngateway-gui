// 責務: 試験の順序・検証サーバへの到達の確認・ログインの失効の確認・中断の扱い（要件 4.7, 6.1〜6.3）。
// 試験は渡された順に 1 件ずつ実行する。試験の前後で API に届くかを確かめ、届かなくなったら、その試験を失敗として
// 記録し、後続の試験を中止する。

import type { ApiClient, ApiResult } from "../../common/api-client";
import type { TestResult } from "../../common/report";

/** 試験 1 件の判定。合格は ok、失敗は期待・観測・理由を返す（秘密を含めない）。 */
export type Verdict =
  | { readonly ok: true; readonly observed?: string }
  | { readonly ok: false; readonly expected: string; readonly observed: string; readonly reason?: string };

/** 試験 1 件。name は `proton/…` の形、requirement は要件 ID（例: 4.2）。 */
export interface ScenarioCase {
  readonly name: string;
  readonly requirement: string;
  readonly run: () => Promise<Verdict>;
}

/** 試験の実行に渡す依存。signal は中断（Ctrl-C）で、次の試験の前に止める。 */
export interface RunOptions {
  readonly api: ApiClient;
  readonly signal?: AbortSignal;
}

/** 検証サーバの状態。届かない・ログインが失効した・取得の失敗を区別する。 */
export type Reachability =
  | { readonly kind: "logged-in" }
  | { readonly kind: "logged-out" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "error"; readonly message: string };

/**
 * 目的: API の応答を、端末に表示する短い文言にする（秘密を含まない。API の message と error のみを使う）。
 * 入力: res(API の応答)。
 * 出力: 応答の概要の文字列。
 * 例: describeApi({ ok: false, kind: "http", status: 403, error: "operation_restricted", message: "..." }) // => "HTTP 403 operation_restricted（...）"
 */
export function describeApi(res: ApiResult<unknown>): string {
  if (res.ok) return `HTTP ${res.status}`;
  if (res.kind === "http") return `HTTP ${res.status} ${res.error}（${res.message}）`;
  return `通信の失敗（${res.message}）`;
}

/**
 * 目的: GET /v1/session を 1 回送り、検証サーバへの到達とログインの状態を分類する。
 * 入力: api(管理者の Cookie を保持する API クライアント)。
 * 出力: Reachability。通信の失敗だけを unreachable とする（HTTP の失敗は error）。
 */
export async function probeSession(api: ApiClient): Promise<Reachability> {
  const res = await api.get<{ loggedIn?: boolean }>("/v1/session");
  if (res.ok) return res.body.loggedIn === true ? { kind: "logged-in" } : { kind: "logged-out" };
  if (res.kind === "transport") return { kind: "unreachable" };
  return { kind: "error", message: describeApi(res) };
}

/** 試験の結果を、失敗として記録する（理由のみ）。 */
function failure(scenario: ScenarioCase, reason: string): TestResult {
  return { name: scenario.name, requirement: scenario.requirement, outcome: "fail", reason };
}

/** 判定を、報告の 1 件の結果にする。 */
function toResult(scenario: ScenarioCase, verdict: Verdict): TestResult {
  if (verdict.ok) return { name: scenario.name, requirement: scenario.requirement, outcome: "pass", observed: verdict.observed };
  return {
    name: scenario.name,
    requirement: scenario.requirement,
    outcome: "fail",
    expected: verdict.expected,
    observed: verdict.observed,
    reason: verdict.reason,
  };
}

/**
 * 目的: 試験の判定を実行する。例外は試験の失敗として扱い、後続の試験を止めない。
 * 入力: scenario(試験 1 件)。
 * 出力: Verdict。
 */
async function runOne(scenario: ScenarioCase): Promise<Verdict> {
  try {
    return await scenario.run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, expected: "試験が完了する", observed: "例外で中断した", reason: message };
  }
}

/**
 * 目的: 試験を渡された順に 1 件ずつ実行し、結果の一覧を返す。
 * 入力: cases(試験の順序どおりの一覧)、options(API と中断の信号)。
 * 出力: TestResult の一覧（試験と同じ順序）。
 * 失敗時の方針: 試験の前後で GET /v1/session が届かなければ、その試験を失敗として記録し、後続を中止する（6.2・6.3）。
 *   ログインが失効していれば、その試験を失敗として記録する（4.7）。中断の信号が立っていれば、残りを実行せずに記録する。
 */
export async function runCases(cases: readonly ScenarioCase[], options: RunOptions): Promise<TestResult[]> {
  const results: TestResult[] = [];
  let lost = false; // 検証サーバへの到達を失った。以降の試験は中止する

  for (const scenario of cases) {
    if (lost) {
      results.push(failure(scenario, "前の試験で検証サーバへの到達を失ったため中止"));
      continue;
    }
    if (options.signal?.aborted) {
      results.push(failure(scenario, "中断（Ctrl-C）のため実行しなかった"));
      continue;
    }

    const before = await probeSession(options.api);
    if (before.kind === "unreachable") {
      lost = true;
      results.push(failure(scenario, "検証サーバへの到達の失敗"));
      continue;
    }
    if (before.kind === "logged-out") {
      results.push(failure(scenario, "ログインが失効した"));
      continue;
    }
    if (before.kind === "error") {
      results.push(failure(scenario, `状態を取得できない（${before.message}）`));
      continue;
    }

    const verdict = await runOne(scenario);
    const after = await probeSession(options.api);
    if (after.kind === "unreachable") {
      lost = true;
      results.push(failure(scenario, "検証サーバへの到達の失敗"));
      continue;
    }
    if (after.kind === "logged-out") {
      results.push(failure(scenario, "試験の途中でログインが失効した"));
      continue;
    }
    results.push(toResult(scenario, verdict));
  }

  return results;
}
