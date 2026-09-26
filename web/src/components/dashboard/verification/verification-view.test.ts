// 責務: 動作検証の表示ロジック（verification-view.ts）の単体テスト。グループの状態・閉じているときの代表行・件数。

import { describe, expect, it } from "vitest";
import { summarizeGroup, totalsOf, type VerificationCheck } from "./verification-view";

function check(id: string, status: VerificationCheck["status"], group: VerificationCheck["group"] = "gateway"): VerificationCheck {
  return { id, title: id, group, status };
}

describe("summarizeGroup", () => {
  it("どれも始まっていなければ待機中で、代表行は無い", () => {
    const summary = summarizeGroup([check("a", "pending"), check("b", "pending")], "gateway");
    expect(summary).toMatchObject({ state: "wait", done: 0, representative: undefined });
  });

  it("実行中の項目があれば実行中で、代表行はその項目。先に出たNGの件数も数える", () => {
    const summary = summarizeGroup([check("a", "fail"), check("b", "running"), check("c", "pending")], "gateway");
    expect(summary.state).toBe("running");
    expect(summary.representative?.id).toBe("b");
    expect(summary.failCount).toBe(1);
  });

  it("完了後は、NG＞未確認の優先度で、グループ内で最初に発生した問題を代表行にする", () => {
    const withFail = summarizeGroup([check("a", "unconfirmed"), check("b", "fail"), check("c", "fail")], "gateway");
    expect(withFail).toMatchObject({ state: "fail", failCount: 2, unconfirmedCount: 1 });
    expect(withFail.representative?.id).toBe("b");
    const withUnconfirmed = summarizeGroup([check("a", "pass"), check("b", "unconfirmed"), check("c", "unconfirmed")], "gateway");
    expect(withUnconfirmed.state).toBe("unconfirmed");
    expect(withUnconfirmed.representative?.id).toBe("b");
  });

  it("すべてOKなら代表行は無い。対象外と他のグループの項目は数えない", () => {
    const summary = summarizeGroup(
      [check("a", "pass"), check("b", "notApplicable"), check("c", "fail", "config")],
      "gateway",
    );
    expect(summary).toMatchObject({ state: "pass", done: 1, representative: undefined });
    expect(summary.checks).toHaveLength(1);
  });

  it("項目の切り替わりの瞬間（一部確定・実行中なし）は実行中", () => {
    expect(summarizeGroup([check("a", "pass"), check("b", "pending")], "gateway").state).toBe("running");
  });
});

describe("totalsOf", () => {
  it("対象外を除いて、結果ごとに数える", () => {
    expect(totalsOf([check("a", "pass"), check("b", "fail"), check("c", "unconfirmed"), check("d", "running"), check("e", "notApplicable")])).toEqual({
      total: 4,
      done: 3,
      pass: 1,
      fail: 1,
      unconfirmed: 1,
    });
  });
});
