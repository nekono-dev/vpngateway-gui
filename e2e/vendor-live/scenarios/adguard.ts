// 責務: AdGuard VPN の試験（接続・切断・終了時の切断）。要件 4.2・4.3・4.4・4.8。
// AdGuard は自動接続を持たないため、接続は一覧の先頭の接続先を指定して行う。
// プラン制限（4.5）は、2.6 の実機の観測で期待値を決めてから加える（まだ含めない）。

import type { ApiClient } from "../../common/api-client";
import { connectedEgressCase, disconnectedEgressCase, endDisconnectedCase, firstLocationId } from "./connection";
import { describeApi, type ScenarioCase } from "./run";

/** 試験の依存。 */
export interface AdGuardCaseOptions {
  readonly api: ApiClient;
  readonly baselineIp: string;
}

/**
 * 目的: AdGuard の試験を、実行の順序どおりに組み立てる。
 * 入力: options(API と基準の IP)。
 * 出力: 試験の一覧（接続 → 切断 → 切断後の確認 → 終了時の切断）。
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
  return [connectedEgressCase(common), disconnectedEgressCase(common), endDisconnectedCase(common)];
}
