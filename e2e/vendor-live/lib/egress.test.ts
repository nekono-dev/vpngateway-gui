// 責務: tunnel-egress の観測値の解釈（classifyTunnelEgress）の単体テスト。各区分が要件 4.2・4.3 の判定に対応することを確かめる。

import { describe, expect, it } from "vitest";
import { classifyTunnelEgress, type CheckLike } from "./egress";

const base = { id: "tunnel-egress" } as const;

describe("classifyTunnelEgress", () => {
  it("合格で IPv4 が読めたら observed の区分を返す（要件 4.2 の比較に使う）", () => {
    const check: CheckLike = { ...base, status: "pass", observed: "203.0.113.7" };
    expect(classifyTunnelEgress(check)).toEqual({ kind: "observed", ip: "203.0.113.7" });
  });

  it("合格でも IPv4 が無ければ failed とする（合格を IP 無しで通さない）", () => {
    const check: CheckLike = { ...base, status: "pass", observed: "不明" };
    expect(classifyTunnelEgress(check).kind).toBe("failed");
  });

  it("未確認（切断中など）は unconfirmed とし、理由を保持する（要件 4.3）", () => {
    const check: CheckLike = { ...base, status: "unconfirmed", reason: "VPN が接続されていない" };
    expect(classifyTunnelEgress(check)).toEqual({ kind: "unconfirmed", reason: "VPN が接続されていない" });
  });

  it("対象外は not-applicable とする", () => {
    expect(classifyTunnelEgress({ ...base, status: "notApplicable" })).toEqual({ kind: "not-applicable" });
  });

  it("不合格・未完了・項目の欠落は、合格にせず failed とする", () => {
    expect(classifyTunnelEgress({ ...base, status: "fail", reason: "タイムアウト" })).toEqual({ kind: "failed", reason: "タイムアウト" });
    expect(classifyTunnelEgress({ ...base, status: "running" }).kind).toBe("failed");
    expect(classifyTunnelEgress(undefined).kind).toBe("failed");
  });
});
