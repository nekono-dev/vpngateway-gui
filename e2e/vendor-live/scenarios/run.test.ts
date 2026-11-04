// 責務: 試験の順序・検証サーバへの到達・ログインの失効・中断の扱いの単体テスト（要件 4.7・6.1〜6.3）。実機には接続しない。

import { describe, expect, it } from "vitest";
import { fakeApi, httpError, ok, transportError } from "./fake-api";
import { describeApi, runCases, type ScenarioCase } from "./run";

/** セッションの応答（loggedIn）を、呼び出しの回数に応じて返す関数を作る。 */
function sessionReplies(...replies: ReturnType<typeof ok>[]) {
  let index = 0;
  return () => {
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    return reply;
  };
}

const pass = (name: string, requirement = "1.1"): ScenarioCase => ({
  name,
  requirement,
  run: async () => ({ ok: true, observed: `${name} の観測` }),
});

describe("runCases", () => {
  it("全て合格なら、渡された順序どおりに合格の結果を返す", async () => {
    const reply = sessionReplies(ok({ loggedIn: true }));
    const api = fakeApi((method, path) => (method === "GET" && path === "/v1/session" ? reply() : httpError(404, "x")));

    const results = await runCases([pass("proton/一つ目", "4.2"), pass("proton/二つ目", "4.3")], { api });

    expect(results.map((result) => [result.name, result.outcome])).toEqual([
      ["proton/一つ目", "pass"],
      ["proton/二つ目", "pass"],
    ]);
  });

  it("試験の途中で検証サーバに届かなくなると、その試験を失敗にし、後続を中止する", async () => {
    // 1 件目の前後の確認（2 回）は届き、2 件目の前の確認で届かなくなる
    const reply = sessionReplies(ok({ loggedIn: true }), ok({ loggedIn: true }), transportError());
    const api = fakeApi(() => reply());

    const results = await runCases([pass("proton/一つ目"), pass("proton/二つ目"), pass("proton/三つ目")], { api });

    expect(results[0].outcome).toBe("pass");
    expect(results[1]).toMatchObject({ outcome: "fail", reason: "検証サーバへの到達の失敗" });
    expect(results[2]).toMatchObject({ outcome: "fail" });
    expect(results[2].reason).toContain("中止");
  });

  it("ログインが失効していれば、その試験を失敗にし、判定を実行しない", async () => {
    const reply = sessionReplies(ok({ loggedIn: false }));
    let ran = false;
    const scenario: ScenarioCase = {
      name: "proton/失効",
      requirement: "4.7",
      run: async () => {
        ran = true;
        return { ok: true };
      },
    };

    const results = await runCases([scenario], { api: fakeApi(() => reply()) });

    expect(ran).toBe(false);
    expect(results[0]).toMatchObject({ outcome: "fail", reason: "ログインが失効した" });
  });

  it("試験の途中でログインが失効したら、その試験を失敗にする", async () => {
    // 試験の前は有効、試験の後は失効
    const reply = sessionReplies(ok({ loggedIn: true }), ok({ loggedIn: false }));

    const results = await runCases([pass("proton/途中で失効", "4.7")], { api: fakeApi(() => reply()) });

    expect(results[0]).toMatchObject({ outcome: "fail", reason: "試験の途中でログインが失効した" });
  });

  it("中断の信号が立っていれば、残りの試験を実行せずに失敗として記録する", async () => {
    const controller = new AbortController();
    controller.abort();
    const api = fakeApi(() => ok({ loggedIn: true }));

    const results = await runCases([pass("proton/一つ目")], { api, signal: controller.signal });

    expect(results[0]).toMatchObject({ outcome: "fail", reason: "中断（Ctrl-C）のため実行しなかった" });
  });

  it("判定が不合格なら、期待と観測と理由を結果に残す", async () => {
    const api = fakeApi(() => ok({ loggedIn: true }));
    const scenario: ScenarioCase = {
      name: "proton/不合格",
      requirement: "4.2",
      run: async () => ({ ok: false, expected: "基準と異なる IP", observed: "同じ IP", reason: "VPN を通っていない" }),
    };

    const results = await runCases([scenario], { api });

    expect(results[0]).toEqual({
      name: "proton/不合格",
      requirement: "4.2",
      outcome: "fail",
      expected: "基準と異なる IP",
      observed: "同じ IP",
      reason: "VPN を通っていない",
    });
  });

  it("判定が例外を投げても、失敗として記録し、後続の試験は続ける", async () => {
    const api = fakeApi(() => ok({ loggedIn: true }));
    const throws: ScenarioCase = {
      name: "proton/例外",
      requirement: "4.2",
      run: async () => {
        throw new Error("想定外");
      },
    };

    const results = await runCases([throws, pass("proton/後続")], { api });

    expect(results[0]).toMatchObject({ outcome: "fail", reason: "想定外" });
    expect(results[1].outcome).toBe("pass");
  });
});

describe("describeApi", () => {
  it("HTTP の失敗は状態・error・message を、通信の失敗は message を含む", () => {
    expect(describeApi(httpError(403, "operation_restricted", "無料"))).toBe("HTTP 403 operation_restricted（無料）");
    expect(describeApi(transportError("届かない"))).toBe("通信の失敗（届かない）");
    expect(describeApi(ok({}, 201))).toBe("HTTP 201");
  });
});
