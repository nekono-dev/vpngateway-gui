// 責務: 経路の指定を、外段から並んだ計画へ変換し、失敗を段の位置つきのエラーで返すことを確かめる。
import { describe, expect, it } from "vitest";
import type { ChainSpec } from "./chain-spec.js";
import { planChain, type PlanInput } from "./chain-planner.js";
import type { LocationCandidate } from "./hop-selector.js";

const candidates: LocationCandidate[] = [
  { locationId: "JP-tokyo", provider: "adguardvpn", values: { ping: 4 } },
  { locationId: "CH-zurich", provider: "protonvpn", values: { Score: 0.8 } },
  { locationId: "US-seattle", provider: "protonvpn", values: { Score: 2.4 } },
];

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    exitLocationId: "US-seattle",
    exitProvider: "protonvpn",
    candidates,
    rng: () => 0,
    ruleFor: (provider) => (provider === "adguardvpn" ? { value: "ping" } : { value: "Score" }),
    loggedIn: () => true,
    supports: () => true,
    deviceFor: (provider) => `dev-${provider}`,
    ...overrides,
  };
}

describe("planChain", () => {
  it("段数 1（出口だけ）は、入口を持たない計画になる", () => {
    const spec: ChainSpec = { exit: { locationId: "US-seattle" }, hops: [] };
    const result = planChain(spec, input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hops).toEqual([]);
    expect(result.value.exit.locationId).toBe("US-seattle");
    expect(result.value.exit.position).toBe(0);
  });

  it("段の計画は、外段から内段の順に並び、位置は出口からの距離を表す", () => {
    const spec: ChainSpec = {
      exit: { locationId: "US-seattle" },
      hops: [
        { selection: "random", provider: "any", onFailure: "blockAll" }, // 出口の 1 つ前（位置 1）
        { selection: "provider", provider: "adguardvpn", onFailure: "dropHop" }, // 位置 2（最外段）
      ],
    };
    const result = planChain(spec, input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hops.map((hop) => hop.position)).toEqual([2, 1]);
    expect(result.value.hops[0].provider).toBe("adguardvpn");
    expect(result.value.hops[0].onFailure).toBe("dropHop");
    expect(result.value.hops[1].onFailure).toBe("blockAll");
  });

  it("候補が無い段は、段の位置つきの no-candidate を返す", () => {
    const spec: ChainSpec = {
      exit: { locationId: "US-seattle" },
      hops: [{ selection: "manual", provider: "exit", manualLocationId: "DE-berlin", onFailure: "blockAll" }],
    };
    expect(planChain(spec, input())).toEqual({ ok: false, error: { kind: "no-candidate", hopIndex: 0 } });
  });

  it("ログインが失われている提供元の段は、relogin-required を段の位置つきで返す", () => {
    const spec: ChainSpec = {
      exit: { locationId: "US-seattle" },
      hops: [{ selection: "random", provider: "adguardvpn", onFailure: "blockAll" }],
    };
    const result = planChain(spec, input({ loggedIn: (provider) => provider !== "adguardvpn" }));
    expect(result).toEqual({ ok: false, error: { kind: "relogin-required", hopIndex: 0 } });
  });

  it("プランで利用できない提供元の段は、plan-unavailable を理由つきで返す", () => {
    const spec: ChainSpec = {
      exit: { locationId: "US-seattle" },
      hops: [{ selection: "random", provider: "adguardvpn", onFailure: "blockAll" }],
    };
    const result = planChain(spec, input({ supports: (provider) => provider !== "adguardvpn" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: "plan-unavailable", hopIndex: 0, reason: "plan" });
  });

  it("選び方の規則が宣言されていない提供元の段は、plan-unavailable を返す", () => {
    const spec: ChainSpec = {
      exit: { locationId: "US-seattle" },
      hops: [{ selection: "provider", provider: "protonvpn", onFailure: "blockAll" }],
    };
    const result = planChain(spec, input({ ruleFor: () => undefined }));
    expect(result).toEqual({ ok: false, error: { kind: "plan-unavailable", hopIndex: 0, reason: "rule-missing" } });
  });
  it("提供元を「どれでも」にして選ばれた候補がログインしていない提供元なら、relogin-required を返す", () => {
    const spec: ChainSpec = {
      exit: { locationId: "US-seattle" },
      hops: [{ selection: "random", provider: "any", onFailure: "blockAll" }],
    };
    // rng 0 で先頭の候補（adguardvpn の JP-tokyo）が選ばれる。その提供元はログインしていない。
    const result = planChain(spec, input({ loggedIn: (provider) => provider !== "adguardvpn" }));
    expect(result).toEqual({ ok: false, error: { kind: "relogin-required", hopIndex: 0 } });
  });
});
