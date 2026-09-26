// 責務: この端末からの確認（L3）の判定（client-judgements.ts）の単体テスト。

import { describe, expect, it } from "vitest";
import { judgeClientEgress, judgeDnsRedirect } from "./client-judgements.js";

describe("judgeClientEgress", () => {
  it("トンネルの出口IPと一致すれば合格、異なれば不合格", () => {
    expect(judgeClientEgress("198.51.100.7", "198.51.100.7").status).toBe("pass");
    const mismatch = judgeClientEgress("203.0.113.9", "198.51.100.7");
    expect(mismatch).toMatchObject({ status: "fail", observed: "203.0.113.9" });
  });

  it("ブラウザの取得失敗・未提出・トンネルの出口IPなしは未確認", () => {
    expect(judgeClientEgress(null, "198.51.100.7").reason).toContain("IP確認サービスに接続できませんでした");
    expect(judgeClientEgress(undefined, "198.51.100.7").status).toBe("unconfirmed");
    expect(judgeClientEgress("198.51.100.7", undefined).status).toBe("unconfirmed");
  });
});

describe("judgeDnsRedirect", () => {
  it("この端末の問い合わせが誘導されていれば合格", () => {
    expect(judgeDnsRedirect({ received: true, redirected: true, recentRedirectedClients: 1 }).status).toBe("pass");
  });

  it("この端末で確認できなくても、直近の誘導の実績があれば合格（実績である旨を示す）", () => {
    const outcome = judgeDnsRedirect({ received: false, redirected: false, recentRedirectedClients: 3 });
    expect(outcome.status).toBe("pass");
    expect(outcome.observed).toContain("3 台");
  });

  it("ゲートウェイへ直接届いた・届かなかった場合は、実績が無ければ未確認（不合格にしない）", () => {
    expect(judgeDnsRedirect({ received: true, redirected: false, recentRedirectedClients: 0 }).reason).toContain("直接使っている");
    const notReceived = judgeDnsRedirect({ received: false, redirected: false, recentRedirectedClients: 0 });
    expect(notReceived.status).toBe("unconfirmed");
    expect(notReceived.hint).toContain("暗号化DNS");
    expect(judgeDnsRedirect(undefined).status).toBe("unconfirmed");
  });
});
