// 責務: 段ごとの接続先の選び方（ランダム・プロバイダ選択・手動選択）が、仕様どおりの接続先を返すことを確かめる。
import { describe, expect, it } from "vitest";
import { resolveHop, type HopSelectionContext, type LocationCandidate } from "./hop-selector.js";

const pool: LocationCandidate[] = [
  { locationId: "JP-tokyo", provider: "adguardvpn", values: { ping: 4 } },
  { locationId: "US-lasvegas", provider: "adguardvpn", values: { ping: 153 } },
  { locationId: "CH-zurich", provider: "protonvpn", values: { Score: 0.8 } },
  { locationId: "US-seattle", provider: "protonvpn", values: { Score: 2.4 } },
];

// 提供元ごとの選ぶ規則（profile の hopSelection に相当）。ProtonVPN は Score、AdGuard VPN は ping の最小。
const ruleFor = (provider: string): { value: string } | undefined =>
  provider === "adguardvpn" ? { value: "ping" } : provider === "protonvpn" ? { value: "Score" } : undefined;

function ctx(rng: () => number, exitProvider: string, candidates: LocationCandidate[] = pool): HopSelectionContext {
  return { exitProvider, candidates, rng, ruleFor };
}

describe("resolveHop", () => {
  it("ランダムは乱数に従って候補から 1 つ選ぶ", () => {
    const first = resolveHop({ selection: "random", provider: "any", onFailure: "blockAll" }, ctx(() => 0, "protonvpn"));
    const last = resolveHop({ selection: "random", provider: "any", onFailure: "blockAll" }, ctx(() => 0.999, "protonvpn"));
    expect(first).toEqual({ ok: true, value: pool[0] });
    expect(last).toEqual({ ok: true, value: pool[3] });
  });

  it("プロバイダ選択で提供元が exit のときは、出口と同じ提供元の候補から規則で最小を選ぶ", () => {
    const result = resolveHop({ selection: "provider", provider: "exit", onFailure: "blockAll" }, ctx(() => 0, "protonvpn"));
    expect(result).toEqual({ ok: true, value: pool[2] }); // CH-zurich（Score 0.8）
  });

  it("プロバイダ選択で提供元を明示すると、その提供元の規則で選ぶ", () => {
    const result = resolveHop({ selection: "provider", provider: "adguardvpn", onFailure: "blockAll" }, ctx(() => 0, "protonvpn"));
    expect(result).toEqual({ ok: true, value: pool[0] }); // JP-tokyo（ping 4）
  });

  it("手動選択は指定された接続先をそのまま返す", () => {
    const result = resolveHop(
      { selection: "manual", provider: "exit", manualLocationId: "US-lasvegas", onFailure: "dropHop" },
      ctx(() => 0, "protonvpn"),
    );
    expect(result).toEqual({ ok: true, value: pool[1] });
  });

  it("手動選択で指定先が候補に無ければ no-candidate を返す", () => {
    const result = resolveHop(
      { selection: "manual", provider: "exit", manualLocationId: "DE-berlin", onFailure: "blockAll" },
      ctx(() => 0, "protonvpn"),
    );
    expect(result).toEqual({ ok: false, error: { kind: "no-candidate" } });
  });

  it("候補が空なら no-candidate を返す", () => {
    const result = resolveHop(
      { selection: "random", provider: "any", onFailure: "blockAll" },
      ctx(() => 0, "protonvpn", []),
    );
    expect(result).toEqual({ ok: false, error: { kind: "no-candidate" } });
  });

  it("プロバイダ選択の提供元に規則が無いなら rule-missing を返す", () => {
    const result = resolveHop({ selection: "provider", provider: "unknownvpn", onFailure: "blockAll" }, ctx(() => 0, "protonvpn"));
    expect(result).toEqual({ ok: false, error: { kind: "rule-missing", provider: "unknownvpn" } });
  });
});
