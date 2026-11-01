// 責務: Playwright の JSON 結果を、共有の報告（TestResult）に変換して summary.txt などに書き出す（要件 1.1）。
// 試験の名前の先頭の要件 ID（例: "9.1: ..."）を requirement に入れる。ID が無ければ "-" とする。

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { writeReport, type TestResult } from "../../common/report";

/** Playwright の JSON 報告の、本ツールが読む部分。 */
interface PwSuite {
  readonly title: string;
  readonly file?: string;
  readonly suites?: readonly PwSuite[];
  readonly specs?: readonly PwSpec[];
}
interface PwSpec {
  readonly title: string;
  readonly ok: boolean;
  readonly tests: readonly { readonly projectName: string; readonly status: string; readonly expectedStatus: string; readonly results: readonly { readonly error?: { readonly message?: string } }[] }[];
  readonly file?: string;
}

/**
 * 目的: Playwright の報告の木を、試験の一覧（TestResult）へ平たくする。
 * 入力: suite（報告の 1 つの節）、group（先頭の群）。
 * 出力: 試験の結果の配列。合否は expectedStatus と status で決める（test.fail の期待どおりの失敗は合格）。
 */
export function flatten(suite: PwSuite, group = ""): TestResult[] {
  const out: TestResult[] = [];
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      const passed = test.status === test.expectedStatus;
      const message = test.results.find((r) => r.error?.message !== undefined)?.error?.message;
      const requirement = /(\d+\.\d+)/.exec(spec.title)?.[1] ?? "-";
      out.push({
        name: `${group || test.projectName} › ${spec.title}`,
        requirement,
        outcome: passed ? "pass" : "fail",
        expected: test.expectedStatus,
        observed: test.status,
        ...(passed || message === undefined ? {} : { reason: message.split("\n")[0] }),
      });
    }
  }
  for (const child of suite.suites ?? []) out.push(...flatten(child, group || child.title));
  return out;
}

/**
 * 目的: 群ごとの Playwright の JSON 報告を読み、共有の報告として書き出す（results.json・summary.txt）。
 * 入力: jsonPaths（群ごとの Playwright の JSON。ファイル名の先頭を群の名前にする）、outDir（書き出し先）、forbidden（含めてはならない秘密の文字列）。
 * 出力: 合格・不合格の件数。
 */
export async function summarize(jsonPaths: readonly string[], outDir: string, forbidden: readonly string[]): Promise<{ passed: number; failed: number }> {
  const results = jsonPaths.flatMap((jsonPath) => {
    const group = basename(jsonPath, ".json");
    const report = JSON.parse(readFileSync(jsonPath, "utf8")) as { suites: PwSuite[] };
    return report.suites.flatMap((suite) => flatten(suite, group));
  });
  await writeReport(outDir, results, forbidden);
  const passed = results.filter((r) => r.outcome === "pass").length;
  return { passed, failed: results.length - passed };
}

// 直接実行: tsx e2e/hosted/lib/summarize.ts <出力先> <群の JSON>...
if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [outDir, ...jsonPaths] = process.argv.slice(2);
  if (outDir === undefined || jsonPaths.length === 0) {
    process.stderr.write("使い方: tsx summarize.ts <出力先> <群の JSON>...\n");
    process.exit(2);
  }
  const forbidden = [process.env.E2E_ADMIN_PASSWORD ?? ""].filter((s) => s !== "");
  summarize(jsonPaths, outDir, forbidden).then(({ passed, failed }) => {
    process.stdout.write(`合格 ${passed} 件 / 不合格 ${failed} 件\n`);
    process.exit(failed === 0 ? 0 : 1);
  });
}
