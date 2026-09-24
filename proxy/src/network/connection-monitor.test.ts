// 責務: checkConnectionOnce（デフォルトルートからのVPN接続状態判定→GatewayControllerへの反映）の単体テスト。
// getEgressInterfaceはvi.mockで差し替え、実`ip`コマンドには依存しない。

import { describe, expect, it, vi } from "vitest";

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
