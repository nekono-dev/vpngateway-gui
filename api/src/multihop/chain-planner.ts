// 責務: 経路の指定（ChainSpec）を、外段から並んだ計画（ChainPlan）へ変換する。副作用を持たない。
// 候補・ログイン状態・プランの利用可否・デバイスの登録は入力として受け取り、ここでは取得しない。

import type { ChainSpec, HopFailurePolicy, HopSpec } from "./chain-spec.js";
import { resolveHop, type HopSelectionError, type LocationCandidate } from "./hop-selector.js";
import { err, ok, type Result } from "./result.js";

export interface HopPlan {
  // 出口からの位置（出口の 1 つ前が 1）。出口自身は 0。
  position: number;
  locationId: string;
  provider: string;
  deviceId: string;
  onFailure: HopFailurePolicy;
}

export interface ChainPlan {
  // 外段から順（接続の順序）。段数 1 のときは空。
  hops: ReadonlyArray<HopPlan>;
  exit: HopPlan;
}

export type ChainError =
  | { kind: "no-candidate"; hopIndex: number }
  | { kind: "plan-unavailable"; hopIndex: number; reason: "plan" | "rule-missing" | "provider-required" | "device" }
  | { kind: "relogin-required"; hopIndex: number };

export interface PlanInput {
  exitLocationId: string;
  exitProvider: string;
  candidates: ReadonlyArray<LocationCandidate>;
  rng: () => number;
  ruleFor: (provider: string) => { value: string } | undefined;
  // 提供元のプランで、多段接続に使えるか。
  supports: (provider: string) => boolean;
  // 提供元のデバイスがログイン済みか。
  loggedIn: (provider: string) => boolean;
  // 提供元のデバイス（段）の識別子。未登録なら undefined。
  deviceFor: (provider: string) => string | undefined;
}

// 段の指定が具体的な提供元を指すとき、その提供元（"any" は具体的な提供元を持たない）。
function concreteProvider(hop: HopSpec, exitProvider: string): string | undefined {
  if (hop.provider === "exit") return exitProvider;
  if (hop.provider === "any") return undefined;
  return hop.provider;
}

function checkProviderState(provider: string, hopIndex: number, input: PlanInput): ChainError | undefined {
  if (!input.supports(provider)) return { kind: "plan-unavailable", hopIndex, reason: "plan" };
  if (!input.loggedIn(provider)) return { kind: "relogin-required", hopIndex };
  if (input.deviceFor(provider) === undefined) return { kind: "plan-unavailable", hopIndex, reason: "device" };
  return undefined;
}

function toChainError(error: HopSelectionError, hopIndex: number): ChainError {
  if (error.kind === "no-candidate") return { kind: "no-candidate", hopIndex };
  if (error.kind === "rule-missing") return { kind: "plan-unavailable", hopIndex, reason: "rule-missing" };
  return { kind: "plan-unavailable", hopIndex, reason: "provider-required" };
}

export function planChain(spec: ChainSpec, input: PlanInput): Result<ChainPlan, ChainError> {
  const exitDevice = input.deviceFor(input.exitProvider);
  const exit: HopPlan = {
    position: 0,
    locationId: input.exitLocationId,
    provider: input.exitProvider,
    deviceId: exitDevice ?? "",
    onFailure: "blockAll",
  };
  if (exitDevice === undefined) return err({ kind: "plan-unavailable", hopIndex: -1, reason: "device" });

  // spec.hops は出口に近い順（hops[0] が出口の 1 つ前）。計画は外段から並べ直す。
  const planned: HopPlan[] = [];
  for (let hopIndex = 0; hopIndex < spec.hops.length; hopIndex += 1) {
    const hop = spec.hops[hopIndex];
    const declared = concreteProvider(hop, input.exitProvider);
    if (declared !== undefined) {
      const declaredError = checkProviderState(declared, hopIndex, input);
      if (declaredError) return err(declaredError);
    }

    const selected = resolveHop(hop, {
      exitProvider: input.exitProvider,
      candidates: input.candidates,
      rng: input.rng,
      ruleFor: input.ruleFor,
    });
    if (!selected.ok) return err(toChainError(selected.error, hopIndex));

    // 提供元を「どれでも」にしたときは、選ばれた候補の提供元も同じ検査を受ける。
    const provider = selected.value.provider;
    const chosenError = checkProviderState(provider, hopIndex, input);
    if (chosenError) return err(chosenError);
    const deviceId = input.deviceFor(provider) as string;
    planned.push({
      position: hopIndex + 1,
      locationId: selected.value.locationId,
      provider,
      deviceId,
      onFailure: hop.onFailure,
    });
  }

  return ok({ hops: planned.reverse(), exit });
}
