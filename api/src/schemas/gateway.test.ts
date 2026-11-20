// 責務: Gateway 稼働状況スキーマが guard の未適用・適用済み状態を受理することを検証する。

import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { GatewayStatusSchema } from "./gateway.js";

const baseStatus = {
  transparentGateway: { state: "stopped", killSwitchBlocking: false },
  explicitProxy: { state: "stopped", restartCount: 0 },
  lanCidr: "192.0.2.0/24",
};

describe("GatewayStatusSchema", () => {
  it("guard 初回適用前の未知状態と最終更新なしを公開できる", () => {
    expect(Value.Check(GatewayStatusSchema, {
      ...baseStatus,
      gatewayGuard: { state: "UNKNOWN", healthy: false, leaseValid: false, lastUpdatedAt: null },
    })).toBe(true);
  });

  it("guard の healthy 状態と最終更新時刻を公開できる", () => {
    expect(Value.Check(GatewayStatusSchema, {
      ...baseStatus,
      gatewayGuard: { state: "LEASE", healthy: true, leaseValid: true, lastUpdatedAt: "2026-11-18T00:00:00.000Z" },
    })).toBe(true);
  });
});
