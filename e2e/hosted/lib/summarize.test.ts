// 責務: Playwright の報告から共有の報告への変換（summarize.ts の flatten）の単体テスト。要件 1.1 の合否の対応を確かめる。

import { describe, expect, it } from "vitest";
import { flatten } from "./summarize";

const suite = {
  title: "lifecycle",
  specs: [
    { title: "9.1: 導入の後、status が導入済みを示す", ok: true, file: "lifecycle.spec.ts", tests: [{ projectName: "lifecycle", status: "expected", expectedStatus: "passed", results: [{}] }] },
    {
      title: "9.2: 更新",
      ok: false,
      tests: [{ projectName: "lifecycle", status: "unexpected", expectedStatus: "passed", results: [{ error: { message: "版が違う\n詳細" } }] }],
    },
    { title: "確認: 期待どおりに失敗", ok: true, tests: [{ projectName: "smoke", status: "expected", expectedStatus: "passed", results: [{}] }] },
  ],
} as never;

describe("flatten（Playwright の報告 → 共有の報告）", () => {
  it("合格・不合格を、要件 ID と理由つきで平たくする", () => {
    const results = flatten(suite, "lifecycle");
    expect(results[0]).toMatchObject({ requirement: "9.1", outcome: "pass" });
    expect(results[1]).toMatchObject({ requirement: "9.2", outcome: "fail", reason: "版が違う" });
  });

  it("期待どおりに失敗した試験（test.fail）は合格、期待しない skipped は不合格、意図した skip は報告に含めない", () => {
    const skipped = { title: "3.2: 任意", tests: [{ projectName: "gateway", status: "skipped", expectedStatus: "passed", results: [] }] } as never;
    expect(flatten({ title: "g", specs: [skipped] } as never, "gateway")[0]).toMatchObject({ outcome: "fail" });
    const expectedSkip = { title: "3.2: 任意", tests: [{ projectName: "gateway", status: "skipped", expectedStatus: "skipped", results: [] }] } as never;
    expect(flatten({ title: "g", specs: [expectedSkip] } as never, "gateway")).toHaveLength(0);
  });

  it("要件 ID が無い試験は - とする", () => {
    expect(flatten(suite, "lifecycle")[2]?.requirement).toBe("-");
  });
});
