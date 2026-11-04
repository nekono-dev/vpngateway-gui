// 責務: AdGuard VPN の試験（接続・切断・終了時の切断・プラン制限）。要件 4.2〜4.6・4.8。
// AdGuard は自動接続を持たないため、接続は一覧の先頭の接続先を指定して行う。
// プラン制限の期待値は 2.6 の観測で決めた（research.md）:
//   無料版（free）: 一覧に無い接続先（Seoul）の指定は拒否される。一覧にある接続先への接続は成功する。
//   有料版（premium）: 指定した接続先へ接続できる。

import type { ApiClient } from "../../common/api-client";
import { connectedEgressCase, disconnectedEgressCase, endDisconnectedCase, firstLocationId } from "./connection";
import { describeApi, type ScenarioCase, type Verdict } from "./run";

/** 無料版の一覧に無いことを 2.6 で確かめた接続先（Seoul）。 */
export const UNLISTED_PROBE_LOCATION_ID = "kr-seoul";

/** 試験の依存。planId は GET /v1/session のプラン（free・premium）。 */
export interface AdGuardCaseOptions {
  readonly api: ApiClient;
  readonly baselineIp: string;
  readonly planId: string;
}

/**
 * 目的: プランに応じた接続先の指定の制限を確かめる（4.5・4.6）。
 * 入力: options(API とプラン)。
 * 出力: 試験 1 件。無料版は、一覧に無い接続先の指定をサーバが拒否する（HTTP のエラー）ことを確かめる。
 *   有料版は、一覧の先頭の接続先へ接続できることを確かめる。他のプランは判定できないので失敗にする。
 */
function planCase(options: AdGuardCaseOptions): ScenarioCase {
  if (options.planId === "free") {
    return {
      name: "adguard/無料プランは一覧に無い接続先の指定を拒否する",
      requirement: "4.5",
      run: async (): Promise<Verdict> => {
        const res = await options.api.put("/v1/connection", { connect: true, locationId: UNLISTED_PROBE_LOCATION_ID });
        if (!res.ok && res.kind === "http") return { ok: true, observed: `拒否された（${describeApi(res)}）` };
        if (res.ok) return { ok: false, expected: "一覧に無い接続先は拒否される", observed: "接続に成功した" };
        return { ok: false, expected: "一覧に無い接続先は拒否される（HTTP のエラー）", observed: describeApi(res) };
      },
    };
  }
  if (options.planId === "premium" || options.planId === "paid") {
    return {
      name: "adguard/有料プランは指定した接続先へ接続できる",
      requirement: "4.6",
      run: async (): Promise<Verdict> => {
        const found = await firstLocationId(options.api);
        if (!found.ok) return { ok: false, expected: "接続先の一覧が得られる", observed: found.observed };
        const res = await options.api.put("/v1/connection", { connect: true, locationId: found.id });
        if (res.ok) return { ok: true, observed: `接続先 ${found.id} へ接続した` };
        return { ok: false, expected: "指定した接続先へ接続できる", observed: describeApi(res) };
      },
    };
  }
  return {
    name: "adguard/プランを判定できない",
    requirement: "4.5",
    run: async (): Promise<Verdict> => ({ ok: false, expected: "無料（free）または有料（premium）のプラン", observed: `プラン ${options.planId}` }),
  };
}

/**
 * 目的: AdGuard の試験を、実行の順序どおりに組み立てる。
 * 入力: options(API・基準の IP・プラン)。
 * 出力: 試験の一覧（接続 → プラン制限 → 切断 → 切断後の確認 → 終了時の切断）。
 */
export function adguardCases(options: AdGuardCaseOptions): ScenarioCase[] {
  const common = {
    vendor: "adguard",
    api: options.api,
    baselineIp: options.baselineIp,
    connect: async (): Promise<string | undefined> => {
      const found = await firstLocationId(options.api);
      if (!found.ok) return found.observed;
      const res = await options.api.put("/v1/connection", { connect: true, locationId: found.id });
      return res.ok ? undefined : describeApi(res);
    },
  };
  return [connectedEgressCase(common), planCase(options), disconnectedEgressCase(common), endDisconnectedCase(common)];
}
