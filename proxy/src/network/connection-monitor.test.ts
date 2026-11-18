// 責務: checkConnectionOnce（デフォルトルートからのVPN接続状態判定→GatewayControllerへの反映）の単体テスト。
// getEgressInterfaceはvi.mockで差し替え、実`ip`コマンドには依存しない。

import { describe, expect, it, vi } from "vitest";
import { GatewayController } from "./gateway-controller.js";
import { GatewayGuard } from "./gateway-guard.js";
import { buildGuardLeaseRefreshBatch, buildGuardStateBatch } from "./guard-ruleset.js";
import type { NftResult } from "./nft-client.js";

const { getEgressInterfaceMock } = vi.hoisted(() => ({ getEgressInterfaceMock: vi.fn() }));

vi.mock("./tunnel-interface.js", () => ({ getEgressInterface: getEgressInterfaceMock }));

const { checkConnectionOnce } = await import("./connection-monitor.js");

function makeFakeController() {
  const calls: Array<string | undefined> = [];
  return {
    calls,
    refreshCount: 0,
    refreshPolicyRouting: async function (this: { refreshCount: number }) {
      this.refreshCount += 1;
    },
    updateVpnInterface: async (vpnIface: string | undefined) => {
      calls.push(vpnIface);
      return {} as never;
    },
  };
}

describe("checkConnectionOnce", () => {
  it("監視経由のGateway適用失敗でlease更新を止め、成功後にだけ再発行する", async () => {
    vi.useFakeTimers();
    const gatewayResults: NftResult[] = [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "monitor reconcile failed" },
      { exitCode: 0, stdout: "", stderr: "" },
    ];
    const guardBatches: string[] = [];
    const guard = new GatewayGuard("eth0", async (script) => {
      guardBatches.push(script);
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const controller = new GatewayController("eth0", "eth0", async () => gatewayResults.shift() ?? {
      exitCode: 0,
      stdout: "",
      stderr: "",
    }, {
      onReconcileResult: ({ ok, error }) => { void guard.handleGatewayReconcileResult(ok, error); },
    });
    await guard.applySettings(
      { killSwitch: true, transparentGatewayEnabled: true },
      async () => (await controller.applySettings({ killSwitch: true, transparentGatewayEnabled: true })).succeeded,
    );

    getEgressInterfaceMock.mockResolvedValue("tun0");
    await checkConnectionOnce(controller, "eth0");
    expect(controller.getStatus().state).toBe("error");
    expect(guard.getStatus()).toMatchObject({ state: "LEASE", healthy: false, leaseValid: true });

    await vi.advanceTimersByTimeAsync(4000);
    expect(guardBatches).toHaveLength(1);
    expect(guard.getStatus()).toMatchObject({ state: "LEASE", healthy: false, leaseValid: false });

    getEgressInterfaceMock.mockResolvedValue("eth0");
    await checkConnectionOnce(controller, "eth0");
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getStatus().state).toBe("active");
    expect(guard.getStatus()).toMatchObject({ state: "LEASE", healthy: true, leaseValid: true });
    expect(guardBatches).toEqual([
      buildGuardStateBatch("LEASE", "eth0"),
      buildGuardStateBatch("LEASE", "eth0"),
    ]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(guardBatches.at(-1)).toBe(buildGuardLeaseRefreshBatch("eth0"));
    guard.close();
    vi.useRealTimers();
  });

  it("デフォルトルートのインターフェースがlanIfaceと異なる場合、VPN接続中として通知する", async () => {
    getEgressInterfaceMock.mockResolvedValue("tun0");
    const controller = makeFakeController();

    await checkConnectionOnce(controller as never, "eth0");

    expect(controller.calls).toEqual(["tun0"]);
  });

  it("デフォルトルートのインターフェースがlanIfaceと同一の場合、未接続（undefined）として通知する", async () => {
    getEgressInterfaceMock.mockResolvedValue("eth0");
    const controller = makeFakeController();

    await checkConnectionOnce(controller as never, "eth0");

    expect(controller.calls).toEqual([undefined]);
  });

  it("デフォルトルートが取得できない場合、未接続（undefined）として通知する", async () => {
    getEgressInterfaceMock.mockResolvedValue(undefined);
    const controller = makeFakeController();

    await checkConnectionOnce(controller as never, "eth0");

    expect(controller.calls).toEqual([undefined]);
  });

  it("接続状態の反映のあと、ドメイン迂回用の経路の再確認も毎回行う", async () => {
    getEgressInterfaceMock.mockResolvedValue("eth0");
    const controller = makeFakeController();

    await checkConnectionOnce(controller as never, "eth0");

    expect(controller.refreshCount).toBe(1);
  });
});
