// 責務: Gateway guard 状態機械と lease 更新の失敗時動作を検証する。

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGuardLeaseRefreshBatch, buildGuardStateBatch, type GuardState } from "./guard-ruleset.js";
import { GatewayGuard } from "./gateway-guard.js";
import type { NftResult } from "./nft-client.js";

const ok: NftResult = { exitCode: 0, stdout: "", stderr: "" };
const fail: NftResult = { exitCode: 1, stdout: "", stderr: "nft failed" };
const settings = (killSwitch: boolean, transparentGatewayEnabled: boolean) => ({ killSwitch, transparentGatewayEnabled });
const gatewayApplied = vi.fn(async () => true);

describe("GatewayGuard", () => {
  afterEach(() => vi.useRealTimers());

  it("API settings 初回適用までは未知状態で不健康のまま nft を変更しない", () => {
    const runNft = vi.fn(async () => ok);
    const guard = new GatewayGuard("eth0", runNft);

    expect(guard.getStatus()).toMatchObject({ state: "UNKNOWN", healthy: false, lastUpdatedAt: null });
    expect(runNft).not.toHaveBeenCalled();
    guard.close();
  });

  it.each([
    ["BLOCK", true, true, "LEASE"],
    ["BLOCK", false, false, "OFF"],
    ["LEASE", false, true, "OFF"],
    ["OFF", true, true, "LEASE"],
    ["LEASE", true, true, "LEASE"],
    ["OFF", false, false, "OFF"],
  ] as const)("状態 %s で有効値が %s && %s の設定を適用すると %s へ遷移する", async (_from, kill, transparent, to) => {
    const runNft = vi.fn(async () => ok);
    const guard = new GatewayGuard("eth0", runNft);

    await expect(guard.applySettings(settings(kill, transparent), gatewayApplied)).resolves.toBe(true);
    expect(runNft).toHaveBeenCalledWith(buildGuardStateBatch(to as GuardState, "eth0"));
    expect(guard.getStatus()).toMatchObject({ state: to, healthy: true });
    guard.close();
  });

  it("初回 guard batch 失敗では healthy にせず state を変えない", async () => {
    const runNft = vi.fn(async () => fail);
    const guard = new GatewayGuard("eth0", runNft);

    await expect(guard.applySettings(settings(true, true), gatewayApplied)).resolves.toBe(false);
    expect(guard.getStatus()).toMatchObject({ state: "UNKNOWN", healthy: false, lastUpdatedAt: null });
    guard.close();
  });

  it("再起動時の既存 state を初回 settings まで触らず、LEASE は自然失効に任せる", async () => {
    const runNft = vi.fn(async () => ok);
    const guard = new GatewayGuard("eth0", runNft);
    expect(guard.getStatus().state).toBe("UNKNOWN");
    expect(runNft).not.toHaveBeenCalled();

    await guard.applySettings(settings(true, true), gatewayApplied);
    expect(runNft).toHaveBeenCalledTimes(1);
    guard.close();
  });

  it("健康時だけ1秒周期で4秒 lease を更新する", async () => {
    vi.useFakeTimers();
    const runNft = vi.fn(async () => ok);
    const guard = new GatewayGuard("eth0", runNft);
    await guard.applySettings(settings(true, true), gatewayApplied);
    await vi.advanceTimersByTimeAsync(1000);

    expect(runNft).toHaveBeenNthCalledWith(2, buildGuardLeaseRefreshBatch("eth0"));
    expect(guard.getStatus()).toMatchObject({ state: "LEASE", healthy: true });
    guard.close();
  });

  it("OFF では lease 更新せず、healthy のまま OFF を保つ", async () => {
    vi.useFakeTimers();
    const runNft = vi.fn(async () => ok);
    const guard = new GatewayGuard("eth0", runNft);
    await guard.applySettings(settings(true, false), gatewayApplied);
    await vi.advanceTimersByTimeAsync(3000);

    expect(runNft).toHaveBeenCalledTimes(1);
    expect(guard.getStatus()).toMatchObject({ state: "OFF", healthy: true });
    guard.close();
  });

  it("OFF 中の Gateway 失敗と回復では drop 規則を追加せず OFF を再適用する", async () => {
    vi.useFakeTimers();
    const batches: string[] = [];
    const runNft = vi.fn(async (script: string) => {
      batches.push(script);
      return ok;
    });
    const guard = new GatewayGuard("eth0", runNft);
    await guard.applySettings(settings(true, false), gatewayApplied);

    guard.handleGatewayReconcileResult(false, "gateway_apply_failed");
    expect(guard.getStatus()).toMatchObject({ state: "OFF", healthy: false, leaseValid: false });
    guard.handleGatewayReconcileResult(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(guard.getStatus()).toMatchObject({ state: "OFF", healthy: true, leaseValid: false });
    expect(batches).toEqual([buildGuardStateBatch("OFF", "eth0"), buildGuardStateBatch("OFF", "eth0")]);
    expect(batches.join("\n")).not.toContain(" drop");
    guard.close();
  });

  it("外部で健康条件を失った後は lease 更新を止める", async () => {
    vi.useFakeTimers();
    const events: Record<string, unknown>[] = [];
    const runNft = vi.fn(async () => ok);
    const guard = new GatewayGuard("eth0", runNft, { onEvent: (event) => events.push(event) });
    await guard.applySettings(settings(true, true), gatewayApplied);
    guard.markUnhealthy("gateway_ruleset_verification_failed");
    await vi.advanceTimersByTimeAsync(2000);

    expect(runNft).toHaveBeenCalledTimes(1);
    expect(guard.getStatus()).toMatchObject({ state: "LEASE", healthy: false, leaseValid: true });
    expect(events.at(-1)).toMatchObject({ event: "gateway_guard_unhealthy", state: "LEASE" });
    guard.close();
  });

  it("lease 更新失敗後は unhealthy となり後続更新を止める", async () => {
    vi.useFakeTimers();
    const events: Record<string, unknown>[] = [];
    const runNft = vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(fail).mockResolvedValue(ok);
    const guard = new GatewayGuard("eth0", runNft, { onEvent: (event) => events.push(event) });
    await guard.applySettings(settings(true, true), gatewayApplied);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3000);

    expect(runNft).toHaveBeenCalledTimes(2);
    expect(guard.getStatus()).toMatchObject({ state: "LEASE", healthy: false, leaseValid: false });
    expect(events).toContainEqual(expect.objectContaining({ event: "gateway_guard_lease_refresh_error", lastUpdatedAt: expect.any(String) }));
    expect(events).toContainEqual(expect.objectContaining({ event: "gateway_guard_lease_expired", lastUpdatedAt: expect.any(String) }));
    guard.close();
  });

  it("遷移 batch 失敗では適用済み状態・最終更新時刻を保持する", async () => {
    const runNft = vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(fail);
    const guard = new GatewayGuard("eth0", runNft, { now: () => new Date("2026-01-01T00:00:00.000Z") });
    await guard.applySettings(settings(true, true), gatewayApplied);
    const before = guard.getStatus();
    await expect(guard.applySettings(settings(false, false))).resolves.toBe(false);

    expect(guard.getStatus()).toMatchObject({
      state: before.state,
      healthy: false,
      leaseValid: true,
      lastUpdatedAt: before.lastUpdatedAt,
    });
    guard.close();
  });

  it("設定遷移と timer の nft batch を直列化する", async () => {
    vi.useFakeTimers();
    let finishRefresh!: (value: NftResult) => void;
    const runNft = vi.fn().mockResolvedValueOnce(ok).mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; })).mockResolvedValue(ok);
    const guard = new GatewayGuard("eth0", runNft);
    await guard.applySettings(settings(true, true), gatewayApplied);
    await vi.advanceTimersByTimeAsync(1000);
    const switching = guard.applySettings(settings(false, true), gatewayApplied);
    expect(runNft).toHaveBeenCalledTimes(2);
    finishRefresh(ok);
    await switching;
    expect(runNft).toHaveBeenNthCalledWith(3, buildGuardStateBatch("OFF", "eth0"));
    guard.close();
  });

  it("OFF -> LEASE は Gateway ruleset を先に適用してから guard を切り替える", async () => {
    const calls: string[] = [];
    const runNft = vi.fn(async () => { calls.push("guard"); return ok; });
    const guard = new GatewayGuard("eth0", runNft);
    await guard.applySettings(settings(true, false), async () => true);
    calls.length = 0;
    runNft.mockImplementation(async () => { calls.push("guard"); return ok; });
    await expect(guard.applySettings(settings(true, true), async () => { calls.push("gateway"); return true; })).resolves.toBe(true);

    expect(calls).toEqual(["gateway", "guard"]);
    expect(guard.getStatus()).toMatchObject({ state: "LEASE", healthy: true });
    guard.close();
  });

  it("LEASE -> OFF は Gateway ruleset を先に適用してから guard を OFF にする", async () => {
    const calls: string[] = [];
    const runNft = vi.fn(async () => { calls.push("guard"); return ok; });
    const guard = new GatewayGuard("eth0", runNft);
    await guard.applySettings(settings(true, true), async () => true);
    calls.length = 0;
    runNft.mockImplementation(async () => { calls.push("guard"); return ok; });
    await expect(guard.applySettings(settings(true, false), async () => { calls.push("gateway"); return true; })).resolves.toBe(true);

    expect(calls).toEqual(["gateway", "guard"]);
    expect(guard.getStatus()).toMatchObject({ state: "OFF", healthy: true });
    guard.close();
  });

  it("透過ゲートウェイ無効化で正常 teardown なら OFF へ切り替える", async () => {
    const calls: string[] = [];
    const events: Record<string, unknown>[] = [];
    const runNft = vi.fn(async () => { calls.push("guard"); return ok; });
    const guard = new GatewayGuard("eth0", runNft, { onEvent: (event) => events.push(event) });
    await guard.applySettings(settings(true, true), async () => true);
    calls.length = 0;

    await expect(guard.applySettings(settings(true, false), async () => {
      calls.push("gateway-teardown");
      return true;
    })).resolves.toBe(true);

    expect(calls).toEqual(["gateway-teardown", "guard"]);
    expect(guard.getStatus()).toMatchObject({ state: "OFF", healthy: true });
    expect(events).not.toContainEqual(expect.objectContaining({ event: "gateway_guard_gateway_apply_failed" }));
    guard.close();
  });

  it("Gateway 適用失敗では guard 状態を確定せず healthy にしない", async () => {
    const runNft = vi.fn(async () => ok);
    const guard = new GatewayGuard("eth0", runNft);
    await guard.applySettings(settings(true, false), async () => true);
    const before = guard.getStatus();
    const applyRuleset = vi.fn(async () => false);

    await expect(guard.applySettings(settings(true, true), applyRuleset)).resolves.toBe(false);

    expect(applyRuleset).toHaveBeenCalledOnce();
    expect(runNft).toHaveBeenCalledTimes(1);
    expect(guard.getStatus()).toMatchObject({ state: before.state, healthy: false, lastUpdatedAt: before.lastUpdatedAt });
    guard.close();
  });

  it("guard 適用失敗では Gateway ruleset 適用後も状態を確定しない", async () => {
    const runNft = vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(fail);
    const guard = new GatewayGuard("eth0", runNft);
    await guard.applySettings(settings(true, true), async () => true);
    const before = guard.getStatus();
    const applyRuleset = vi.fn(async () => true);

    await expect(guard.applySettings(settings(true, false), applyRuleset)).resolves.toBe(false);

    expect(applyRuleset).toHaveBeenCalledOnce();
    expect(runNft).toHaveBeenCalledTimes(2);
    expect(guard.getStatus()).toMatchObject({ state: before.state, healthy: false, lastUpdatedAt: before.lastUpdatedAt });
    guard.close();
  });

  it("複数 settings 適用を Gateway ruleset と guard batch の組で直列化する", async () => {
    const calls: string[] = [];
    const runNft = vi.fn(async (script: string) => { calls.push(`guard:${script.includes("timeout 4s") ? "LEASE" : "OFF"}`); return ok; });
    const guard = new GatewayGuard("eth0", runNft);
    const first = guard.applySettings(settings(true, true), async () => { calls.push("gateway:first"); return true; });
    const second = guard.applySettings(settings(false, true), async () => { calls.push("gateway:second"); return true; });

    await Promise.all([first, second]);

    expect(calls).toEqual(["gateway:first", "guard:LEASE", "gateway:second", "guard:OFF"]);
    expect(guard.getStatus()).toMatchObject({ state: "OFF", healthy: true });
    guard.close();
  });
});
