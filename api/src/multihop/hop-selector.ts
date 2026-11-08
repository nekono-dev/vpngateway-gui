// 責務: 段ごとの接続先を、選び方（ランダム・プロバイダ選択・手動選択）から決める。副作用を持たない（乱数は注入する）。
// プロバイダ選択の規則（比較する値）はベンダーの宣言（hopSelection）から受け取り、本体にベンダーの分岐を書かない。

import type { HopSpec } from "./chain-spec.js";
import { err, ok, type Result } from "./result.js";

export interface LocationCandidate {
  locationId: string;
  provider: string;
  // 規則が参照する値（例: ping・Score）。値の無い候補は、規則による比較の対象外になる。
  values: Readonly<Record<string, number>>;
}

export interface HopSelectionContext {
  // 出口の接続先の提供元（hop.provider が "exit" のときに使う）。
  exitProvider: string;
  // この段の候補（全提供元。提供元の絞り込みは本関数で行う）。
  candidates: ReadonlyArray<LocationCandidate>;
  // 乱数（0 以上 1 未満）。試験で固定できるよう注入する。
  rng: () => number;
  // 提供元の選ぶ規則（profile の hopSelection の value）。宣言が無い提供元は undefined。
  ruleFor: (provider: string) => { value: string } | undefined;
}

export type HopSelectionError =
  | { kind: "no-candidate" }
  | { kind: "rule-missing"; provider: string }
  | { kind: "provider-required" };

export function resolveHop(hop: HopSpec, context: HopSelectionContext): Result<LocationCandidate, HopSelectionError> {
  if (hop.selection === "manual") {
    const found = context.candidates.find((candidate) => candidate.locationId === hop.manualLocationId);
    return found ? ok(found) : err({ kind: "no-candidate" });
  }

  const provider = hop.provider === "exit" ? context.exitProvider : hop.provider;
  const pool = context.candidates.filter((candidate) => hop.provider === "any" || candidate.provider === provider);

  if (hop.selection === "random") {
    if (pool.length === 0) return err({ kind: "no-candidate" });
    const index = Math.min(pool.length - 1, Math.floor(context.rng() * pool.length));
    return ok(pool[index]);
  }

  // プロバイダ選択: 提供元の規則で最小の値を持つ候補を選ぶ。
  if (hop.provider === "any") return err({ kind: "provider-required" });
  const rule = context.ruleFor(provider);
  if (!rule) return err({ kind: "rule-missing", provider });
  let best: LocationCandidate | undefined;
  for (const candidate of pool) {
    const value = candidate.values[rule.value];
    if (value === undefined) continue;
    if (best === undefined || value < (best.values[rule.value] as number)) best = candidate;
  }
  return best ? ok(best) : err({ kind: "no-candidate" });
}
