// 責務: トンネルの検出・接続状態への追従・起動時の挙動の受け入れテスト。
// 受け入れ条件 proxyserver/AC-3・AC-4・AC-16・AC-18 を、経路の解析関数とコントローラ（nftは差し替え）で確認する。

import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayController } from "../../proxy/src/network/gateway-controller.js";
import type { NftResult } from "../../proxy/src/network/nft-client.js";
import { parseRouteGetInterface } from "../../proxy/src/network/tunnel-interface.js";

// 接続監視は経路の問い合わせ（ipコマンド）を使うため、テストでは検出結果を差し替える。
let egressInterface: string | undefined = "eth0";
vi.mock("../../proxy/src/network/tunnel-interface.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../proxy/src/network/tunnel-interface.js")>();
  return { ...original, getEgressInterface: async () => egressInterface };
});

/** 目的: 実行されたnftスクリプトを記録するスタブを作る。 */
function recordingNft() {
  const scripts: string[] = [];
  const runNft = async (script: string): Promise<NftResult> => {
    scripts.push(script);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { runNft, scripts };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("トンネルの検出と接続状態への追従", () => {
  it("proxyserver/AC-3: 経路の問い合わせ結果から、ポリシールーティング形式でもトンネルのインターフェース名を取り出せる", () => {
    // 専用の経路表へ誘導する型（ポリシールーティング）。
    expect(parseRouteGetInterface("1.1.1.1 dev tun0 table 880 src 172.16.219.2 uid 0\n    cache\n")).toBe("tun0");
    // デフォルト経路を置換する型。
    expect(parseRouteGetInterface("1.1.1.1 via 10.8.0.1 dev wg0 src 10.8.0.2 uid 0\n")).toBe("wg0");
    // 経路が無い出力はインターフェースなしとして扱う。
    expect(parseRouteGetInterface("RTNETLINK answers: Network is unreachable\n")).toBeUndefined();
    expect(parseRouteGetInterface("")).toBeUndefined();
  });

  it("proxyserver/AC-4: トンネルのインターフェースが変わると、ルールが新しいインターフェースで再構成される", async () => {
    const { runNft, scripts } = recordingNft();
    const controller = new GatewayController("eth0", "eth0", runNft);
    await controller.applySettings({ transparentGatewayEnabled: true, killSwitch: true });
    await controller.updateVpnInterface("tun0");
    await controller.updateVpnInterface("tun1");
    expect(scripts).toHaveLength(3);
    expect(scripts[1]).toContain('oifname "tun0" masquerade');
    expect(scripts[2]).toContain('oifname "tun1" masquerade');
    expect(scripts[2]).not.toContain("tun0");
    // 同じインターフェースの通知ではルールに触れない。
    await controller.updateVpnInterface("tun1");
    expect(scripts).toHaveLength(3);
    expect(controller.getStatus()).toMatchObject({ state: "active", vpnInterface: "tun1", killSwitchBlocking: false });
    // 切断を通知すると、Kill Switchによる遮断中として報告される。
    await controller.updateVpnInterface(undefined);
    expect(controller.getStatus()).toMatchObject({ state: "active", killSwitchBlocking: true });
  });

  it("proxyserver/AC-16: 設定を受け取る前はルールに触れず、同じ設定の再通知ではルールを再構成しない", async () => {
    const { runNft, scripts } = recordingNft();
    const controller = new GatewayController("eth0", "eth0", runNft);
    // 起動直後は何も実行しない（前回のルールが遮断を維持する）。
    expect(scripts).toHaveLength(0);
    const settings = { transparentGatewayEnabled: true, killSwitch: true };
    const first = await controller.applySettings(settings);
    expect(first.reconciled).toBe(true);
    expect(scripts).toHaveLength(1);
    const again = await controller.applySettings({ ...settings });
    expect(again.reconciled).toBe(false);
    expect(scripts).toHaveLength(1);
    // 設定が変わると再構成する。
    expect((await controller.applySettings({ ...settings, killSwitch: false })).reconciled).toBe(true);
    expect(scripts).toHaveLength(2);
  });

  it("proxyserver/AC-18: 接続状態の監視は、既定で10秒ごとに実行される", async () => {
    vi.useFakeTimers();
    const { startConnectionMonitor } = await import("../../proxy/src/network/connection-monitor.js");
    const { runNft, scripts } = recordingNft();
    const controller = new GatewayController("eth0", "eth0", runNft);
    await controller.applySettings({ transparentGatewayEnabled: true, killSwitch: true });
    scripts.length = 0;
    egressInterface = "tun0";
    const stop = startConnectionMonitor(controller, "eth0");
    await vi.advanceTimersByTimeAsync(9_999);
    expect(scripts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('oifname "tun0" masquerade');
    stop();
    egressInterface = "eth0";
  });
});
