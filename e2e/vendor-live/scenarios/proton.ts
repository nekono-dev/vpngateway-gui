// 責務: Proton VPN の試験（接続・切断・プラン制限）。要件 4.2・4.3・4.5・4.6・4.8。
// 接続は接続先を指定せずに行う（Proton は自動接続を持つ。無料プランでも使える）。

import type { ApiClient } from "../../common/api-client";
import { connectedEgressCase, disconnectedEgressCase, endDisconnectedCase, firstLocationId } from "./connection";
import { describeApi, type ScenarioCase, type Verdict } from "./run";

/** 試験の依存。planId は GET /v1/session のプラン（free・paid）。 */
export interface ProtonCaseOptions {
  readonly api: ApiClient;
  readonly baselineIp: string;
  readonly planId: string;
}

/**
 * 目的: プランに応じた接続先の指定の制限を確かめる（4.5・4.6）。
 * 入力: options(API とプラン)。
 * 出力: 試験 1 件。無料は、接続先を指定した接続が 403（operation_restricted）になることを確かめる。
 *   有料は、接続先を指定した接続が成功することを確かめる。他のプランは判定できないので失敗にする。
 */
function planCase(options: ProtonCaseOptions): ScenarioCase {
  if (options.planId === "free") {
    return {
      name: "proton/無料プランは接続先を指定した接続が 403（operation_restricted）",
      requirement: "4.5",
      run: async (): Promise<Verdict> => {
        // 実在する接続先（一覧の先頭）を指定する。架空の ID は、制限ではなく「未知の接続先」（400）として拒否される
        const found = await firstLocationId(options.api);
        if (!found.ok) return { ok: false, expected: "接続先の一覧が得られる", observed: found.observed };
        const res = await options.api.put("/v1/connection", { connect: true, locationId: found.id });
        if (!res.ok && res.kind === "http" && res.status === 403 && res.error === "operation_restricted") {
          return { ok: true, observed: `${found.id}: 403 operation_restricted` };
        }
        return { ok: false, expected: "403 operation_restricted", observed: describeApi(res) };
      },
    };
  }
  if (options.planId === "paid") {
    return {
      name: "proton/有料プランは指定した接続先へ接続できる",
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
    name: "proton/プランを判定できない",
    requirement: "4.5",
    run: async (): Promise<Verdict> => ({ ok: false, expected: "無料または有料のプラン", observed: `プラン ${options.planId}` }),
  };
}

/**
 * 目的: Proton の試験を、実行の順序どおりに組み立てる。
 * 入力: options(API・基準の IP・プラン)。
 * 出力: 試験の一覧（接続 → プラン制限 → 切断 → 切断後の確認 → 終了時の切断）。
 */
export function protonCases(options: ProtonCaseOptions): ScenarioCase[] {
  const common = {
    vendor: "proton",
    api: options.api,
    baselineIp: options.baselineIp,
    connect: async (): Promise<string | undefined> => {
      const res = await options.api.put("/v1/connection", { connect: true });
      return res.ok ? undefined : describeApi(res);
    },
  };
  return [
    connectedEgressCase(common),
    planCase(options),
    disconnectedEgressCase(common),
    endDisconnectedCase(common),
  ];
}
