// 責務: Playwright の報告から共有の報告への変換（summarize.ts の flatten）の単体テスト。要件 1.1 の合否の対応を確かめる。

import { describe, expect, it } from "vitest";
import { flatten } from "./summarize";

const suite = {
  title: "lifecycle",
  specs: [
    { title: "9.1: 導入の後、status が導入済みを示す", ok: true, file: "lifecycle.spec.ts", tests: [{ projectName: "lifecycle", status: "expected", expectedStatus: "expected", results: [{}] }] },
    {
      title: "9.2: 更新",
      ok: false,
      tests: [{ projectName: "lifecycle", status: "unexpected", expectedStatus: "expected", results: [{ error: { message: "版が違う\n詳細" } }] }],
    },
    { title: "確認: 期待どおりに失敗", ok: true, tests: [{ projectName: "smoke", status: "expected", expectedStatus: "expected", results: [{}] }] },
  ],
} as never;

describe("flatten（Playwright の報告 → 共有の報告）", () => {
  it("合格・不合格を、要件 ID と理由つきで平たくする", () => {
    const results = flatten(suite, "lifecycle");
    expect(results[0]).toMatchObject({ requirement: "9.1", outcome: "pass" });
    expect(results[1]).toMatchObject({ requirement: "9.2", outcome: "fail", reason: "版が違う" });
  });

  it("要件 ID が無い試験は - とする", () => {
    expect(flatten(suite, "lifecycle")[2]?.requirement).toBe("-");
  });
});
