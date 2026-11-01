// 責務: 共有の報告（report.ts）の単体テスト。秘密の文字列が成果物に現れないこと（要件 5.4 の規則）を確かめる。

import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countForbidden, formatSummary, writeReport, type TestResult } from "./report";

const SECRET = "s3cret-Pa\"ss\\word-XYZ";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "report-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const passing: TestResult = { name: "ログインできる", requirement: "2.1", outcome: "pass", expected: "ダッシュボード", observed: "ダッシュボード" };

describe("writeReport", () => {
  it("秘密の文字列を含まない結果は results.json と summary.txt として書き出す", async () => {
    const out = join(dir, "out");
    await writeReport(out, [passing], [SECRET]);

    const json = JSON.parse(readFileSync(join(out, "results.json"), "utf8")) as TestResult[];
    expect(json).toEqual([passing]);
    expect(readFileSync(join(out, "summary.txt"), "utf8")).toContain("ログインできる");
  });

  it("秘密の文字列（生の値）を含む結果は、何も書き出さずに拒否する", async () => {
    const out = join(dir, "out");
    const leaking: TestResult = { ...passing, observed: `password=${SECRET}` };
    await expect(writeReport(out, [leaking], [SECRET])).rejects.toThrow("秘密の文字列");
    expect(existsSync(out)).toBe(false);
  });

  it("JSON の中で引用符・\\ がエスケープされた形の秘密も拒否する", async () => {
    const out = join(dir, "out");
    const leaking: TestResult = { ...passing, reason: `入力: ${SECRET}` };
    await expect(writeReport(out, [leaking], [SECRET])).rejects.toThrow("秘密の文字列");
  });

  it("拒否の文言に秘密の値を含めない", async () => {
    const leaking: TestResult = { ...passing, observed: SECRET };
    const error = await writeReport(join(dir, "out"), [leaking], [SECRET]).catch((e: unknown) => e);
    expect(String(error)).not.toContain(SECRET);
  });
});

describe("countForbidden と formatSummary", () => {
  it("空の文字列は秘密として数えない（全件に一致してしまうのを防ぐ）", () => {
    expect(countForbidden("anything", [""])).toBe(0);
  });

  it("合否の件数を末尾に付ける", () => {
    const summary = formatSummary([passing, { ...passing, outcome: "fail" }]);
    expect(summary).toContain("合計 2 件 / 合格 1 件 / 不合格 1 件");
  });
});
