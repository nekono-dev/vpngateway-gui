// 責務: 接続・切断・終了時の切断の試験（両方のベンダーで共通の手順）。要件 4.2・4.3・4.8。
// ベンダーごとの試験（proton.ts・adguard.ts）が、この関数の作る試験を並べる。接続の仕方（接続先の指定の有無）だけが異なる。

import type { ApiClient } from "../../common/api-client";
import { observeEgress, type EgressObservation } from "../lib/egress";
import { describeApi, type ScenarioCase, type Verdict } from "./run";

/** 接続の試験に共通の依存。connect は接続を要求し、失敗なら理由の文字列を、成功なら undefined を返す。 */
export interface ConnectionCaseOptions {
  readonly vendor: string;
  readonly api: ApiClient;
  readonly baselineIp: string;
  readonly connect: () => Promise<string | undefined>;
}

/** 出口 IP の観測の結果を、端末に表示する文言にする。 */
export function describeObservation(observation: EgressObservation): string {
  switch (observation.kind) {
    case "observed":
      return `出口 IP ${observation.ip}`;
    case "unconfirmed":
      return `未確認（${observation.reason}）`;
    case "failed":
      return `観測に失敗（${observation.reason}）`;
    case "not-applicable":
      return "対象外（出口 IP の検証の前提の設定が無効）";
  }
}

/**
 * 目的: 接続後の出口 IP が、接続前の基準の IP と異なることを確かめる（4.2）。
 * 入力: observation(出口 IP の観測)、baselineIp(接続前の基準の IP)。
 * 出力: 判定。観測された IP が基準と同じなら、VPN を通っていないとして失敗にする。
 */
export function judgeConnected(observation: EgressObservation, baselineIp: string): Verdict {
  const expected = `基準の IP（${baselineIp}）と異なる出口 IP`;
  if (observation.kind === "observed" && observation.ip !== baselineIp) {
    return { ok: true, observed: `出口 IP ${observation.ip}` };
  }
  if (observation.kind === "observed") {
    return { ok: false, expected, observed: `出口 IP ${observation.ip}（VPN を通っていない）` };
  }
  return { ok: false, expected, observed: describeObservation(observation) };
}

/**
 * 目的: 切断後に、VPN 経由の出口 IP が観測されないことを確かめる（4.3）。切断中の観測は unconfirmed になる。
 * 入力: observation(出口 IP の観測)。
 * 出力: 判定。unconfirmed なら合格。それ以外（観測された IP を含む）は失敗にする。
 */
export function judgeDisconnected(observation: EgressObservation): Verdict {
  if (observation.kind === "unconfirmed") return { ok: true, observed: describeObservation(observation) };
  return { ok: false, expected: "切断後は出口 IP が観測されない（未確認）", observed: describeObservation(observation) };
}

/** 接続後の出口 IP の試験（4.2）。 */
export function connectedEgressCase(options: ConnectionCaseOptions): ScenarioCase {
  return {
    name: `${options.vendor}/接続後の出口 IP が基準と異なる`,
    requirement: "4.2",
    run: async () => {
      const error = await options.connect();
      if (error !== undefined) return { ok: false, expected: "接続に成功する", observed: error };
      return judgeConnected(await observeEgress(options.api), options.baselineIp);
    },
  };
}

/** 切断後の出口 IP の試験（4.3）。切断を要求してから観測する。 */
export function disconnectedEgressCase(options: ConnectionCaseOptions): ScenarioCase {
  return {
    name: `${options.vendor}/切断後は出口 IP が観測されない`,
    requirement: "4.3",
    run: async () => {
      const res = await options.api.put("/v1/connection", { connect: false });
      if (!res.ok) return { ok: false, expected: "切断に成功する", observed: describeApi(res) };
      return judgeDisconnected(await observeEgress(options.api));
    },
  };
}

/**
 * 目的: 試験の終わりに切断されていることを確かめる（4.8）。接続が残っていれば切断してから、もう一度確かめる。
 * 入力: options(API と名前)。
 * 出力: 試験 1 件。切断の要求または確認に失敗したら失敗にする。
 */
export function endDisconnectedCase(options: ConnectionCaseOptions): ScenarioCase {
  return {
    name: `${options.vendor}/終了時に切断している`,
    requirement: "4.8",
    run: async (): Promise<Verdict> => {
      const state = await connectionStatus(options.api);
      if (state.kind === "error") return { ok: false, expected: "接続の状態を取得できる", observed: state.message };
      if (state.status !== "connected") return { ok: true, observed: `状態 ${state.status}` };

      const res = await options.api.put("/v1/connection", { connect: false });
      if (!res.ok) return { ok: false, expected: "切断に成功する", observed: describeApi(res) };
      const after = await connectionStatus(options.api);
      if (after.kind === "error") return { ok: false, expected: "切断済みになる", observed: after.message };
      if (after.status === "disconnected") return { ok: true, observed: "切断を確認した" };
      return { ok: false, expected: "切断済みになる", observed: `状態 ${after.status}` };
    },
  };
}

/** GET /v1/connection の状態。取得できたら status を、できなければ理由を返す。 */
export type ConnectionStatus = { kind: "ok"; status: string } | { kind: "error"; message: string };

/** 目的: 接続の状態（connected・disconnected）を得る。 */
export async function connectionStatus(api: ApiClient): Promise<ConnectionStatus> {
  const res = await api.get<{ status?: string }>("/v1/connection");
  if (!res.ok) return { kind: "error", message: describeApi(res) };
  return { kind: "ok", status: res.body.status ?? "不明" };
}

/** 接続先の一覧の先頭の ID を得る。一覧が得られなければ、理由を返す。 */
export async function firstLocationId(api: ApiClient): Promise<{ ok: true; id: string } | { ok: false; observed: string }> {
  const res = await api.get<{ id: string }[]>("/v1/connection/locations");
  if (!res.ok) return { ok: false, observed: `接続先の一覧: ${describeApi(res)}` };
  const id = res.body[0]?.id;
  if (id === undefined) return { ok: false, observed: "接続先の一覧が空" };
  return { ok: true, id };
}
