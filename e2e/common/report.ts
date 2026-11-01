// 責務: 試験の結果（TestResult）の型と、成果物（results.json・summary.txt）への書き出し。
// 秘密の除外（要件 5.4）の規則は、このファイルの writeReport だけで実装する。hosted と vendor-live の両方が使う。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** 1 件の試験の結果。observed には秘密（資格情報・Cookie・承認コード）を含めないこと。 */
export interface TestResult {
  readonly name: string;          // 試験名
  readonly requirement: string;   // 要件 ID（例: 1.1）
  readonly outcome: "pass" | "fail";
  readonly expected?: string;
  readonly observed?: string;     // 秘密は含めない
  readonly reason?: string;
}

/**
 * 目的: 成果物に書く内容に、与えられた秘密の文字列が含まれないかを確かめる。
 * 入力: content(書き出す文字列全体)、forbidden(含めてはならない文字列。空文字は無視する)。
 * 出力: 含まれる秘密の件数（0 なら書き出してよい）。秘密の値そのものは返さない。
 */
export function countForbidden(content: string, forbidden: readonly string[]): number {
  return forbidden.filter((secret) => secret !== "" && content.includes(secret)).length;
}

/**
 * 目的: 試験の結果を人が読める一覧（グループごとの合否の確認用）へ整形する。
 * 入力: results(試験の結果)。
 * 出力: 1 行 1 件の文字列（`pass|fail  要件ID  試験名`）と、末尾に合否の件数。
 */
export function formatSummary(results: readonly TestResult[]): string {
  const lines = results.map((r) => `${r.outcome.padEnd(4)}  ${r.requirement.padEnd(6)}  ${r.name}`);
  const passed = results.filter((r) => r.outcome === "pass").length;
  lines.push("", `合計 ${results.length} 件 / 合格 ${passed} 件 / 不合格 ${results.length - passed} 件`);
  return `${lines.join("\n")}\n`;
}

/**
 * 目的: 試験の結果を dir へ書き出す（results.json と summary.txt）。書き出しの前に秘密の文字列を検査する。
 * 入力: dir(書き出し先。無ければ作る)、results(試験の結果)、forbidden(含めてはならない秘密の文字列)。
 * 出力: なし。
 * 失敗時の方針: 秘密が含まれていれば、何も書き出さずに例外を投げる（例外の文言に秘密の値は含めない）。
 * 例: await writeReport("e2e/artifacts/hosted", results, [adminPassword])
 */
export async function writeReport(dir: string, results: readonly TestResult[], forbidden: readonly string[]): Promise<void> {
  const json = `${JSON.stringify(results, null, 2)}\n`;
  const summary = formatSummary(results);
  // JSON では引用符や \ が エスケープされるため、生の値と JSON 内の表記の両方で検査する
  const needles = forbidden.flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]);
  const leaked = countForbidden(json, needles) + countForbidden(summary, needles);
  if (leaked > 0) {
    throw new Error(`成果物に秘密の文字列が ${leaked} 件含まれているため、書き出しを中止した`);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "results.json"), json, "utf8");
  await writeFile(join(dir, "summary.txt"), summary, "utf8");
}
