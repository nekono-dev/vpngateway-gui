// 責務: GatewayController（設定・VPN接続状態の変化に応じたnft再構成の調停）の単体テスト。
// 実nftコマンドには依存せず、コンストラクタのrunNftフックにスタブ関数を注入して検証する。

import { describe, expect, it } from "vitest";
import { GatewayController } from "./gateway-controller.js";
import { GATEWAY_TABLE_NAME } from "./ruleset.js";
import type { NftResult } from "./nft-client.js";

function makeRecordingRunNft() {
  const scripts: string[] = [];
  const runNft = async (script: string): Promise<NftResult> => {
    scripts.push(script);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { runNft, scripts };
}

describe("GatewayController", () => {
  it("transparentGatewayEnabled=falseの場合、撤去のみ行いapplyは実行しない", async () => {
    const { runNft, scripts } = makeRecordingRunNft();
    const controller = new GatewayController("eth0", "eth0", runNft);

    const outcome = await controller.applySettings({ transparentGatewayEnabled: false, killSwitch: true });

    expect(outcome.applied).toBe(false);
    expect(outcome.apply).toBeUndefined();
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toBe(`delete table inet ${GATEWAY_TABLE_NAME}\n`);
  });

  it("lanIface未設定の場合、transparentGatewayEnabled=trueでも撤去のみで終える", async () => {
    const { runNft, scripts } = makeRecordingRunNft();
    const controller = new GatewayController(undefined, undefined, runNft);

    const outcome = await controller.applySettings({ transparentGatewayEnabled: true, killSwitch: true });

    expect(outcome.applied).toBe(false);
    expect(scripts).toHaveLength(1);
  });

  it("transparentGatewayEnabled=trueかつVPN未接続の場合、撤去と適用を1回のnft呼び出し（原子的置換）で行う", async () => {
    const { runNft, scripts } = makeRecordingRunNft();
    const controller = new GatewayController("eth0", "eth0", runNft);

    const outcome = await controller.applySettings({ transparentGatewayEnabled: true, killSwitch: true });

    expect(outcome.applied).toBe(true);
    expect(scripts).toHaveLength(1);
    // 同一スクリプト内で「add→delete→add」の順に並び、フィルタ不在の瞬間ができない。
    expect(scripts[0].indexOf("delete table")).toBeGreaterThan(scripts[0].indexOf("add table"));
    expect(scripts[0].lastIndexOf("add table")).toBeGreaterThan(scripts[0].indexOf("delete table"));
    // DNAT済み通信用のacceptを除き、インターフェース間転送のacceptルールが無いこと（フェイルクローズ）。
    expect(scripts[0]).not.toMatch(/iifname "eth0" oifname .* accept/);
  });

  it("VPNインターフェースが変化した場合のみ再構成し、同じ値の再通知は無視する", async () => {
    const { runNft, scripts } = makeRecordingRunNft();
    const controller = new GatewayController("eth0", "eth0", runNft);
    await controller.applySettings({ transparentGatewayEnabled: true, killSwitch: true });
    scripts.length = 0;

    await controller.updateVpnInterface("tun0");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('oifname "tun0" masquerade');

    scripts.length = 0;
    await controller.updateVpnInterface("tun0");
    expect(scripts).toHaveLength(0);
  });

  it("VPN切断検知（updateVpnInterface(undefined)）でacceptルールが撤去される（Kill Switch）", async () => {
    const { runNft, scripts } = makeRecordingRunNft();
    const controller = new GatewayController("eth0", "eth0", runNft);
    await controller.applySettings({ transparentGatewayEnabled: true, killSwitch: true });
    await controller.updateVpnInterface("tun0");
    scripts.length = 0;

    const outcome = await controller.updateVpnInterface(undefined);

    expect(outcome.apply?.exitCode).toBe(0);
    // DNAT済み通信用のacceptを除き、インターフェース間転送のacceptルールが無いこと（フェイルクローズ）。
    expect(scripts[0]).not.toMatch(/iifname "eth0" oifname .* accept/);
  });

  it("設定が前回成功した適用と同じ場合、定期再通知ではnftを触らない。最初の通知は必ず適用する", async () => {
    const { runNft, scripts } = makeRecordingRunNft();
    const controller = new GatewayController("eth0", "eth0", runNft);
    const settings = { transparentGatewayEnabled: true, killSwitch: true };

    const first = await controller.applySettings(settings);
    expect(first.reconciled).toBe(true);
    expect(scripts).toHaveLength(1);

    const second = await controller.applySettings({ ...settings });
    expect(second.reconciled).toBe(false);
    expect(second.applied).toBe(true);
    expect(scripts).toHaveLength(1);

    const third = await controller.applySettings({ ...settings, killSwitch: false });
    expect(third.reconciled).toBe(true);
    expect(scripts).toHaveLength(2);
  });

  it("前回のnft適用が失敗していれば、同じ設定の再通知でも再試行する", async () => {
    let call = 0;
    const scripts: string[] = [];
    const runNft = async (script: string): Promise<NftResult> => {
      scripts.push(script);
      call += 1;
      return { exitCode: call === 1 ? 1 : 0, stdout: "", stderr: "" };
    };
    const controller = new GatewayController("eth0", "eth0", runNft);
    const settings = { transparentGatewayEnabled: true, killSwitch: true };

    expect((await controller.applySettings(settings)).applied).toBe(false);
    expect((await controller.applySettings(settings)).applied).toBe(true);
    expect(scripts).toHaveLength(2);
  });

  describe("getStatus", () => {
    const enabledKs = { transparentGatewayEnabled: true, killSwitch: true };

    it("設定受信前（起動直後）は stopped を返す", () => {
      const controller = new GatewayController("eth0", "eth0", makeRecordingRunNft().runNft);
      expect(controller.getStatus()).toEqual({ state: "stopped", killSwitchBlocking: false });
    });

    it("transparentGatewayEnabled=false は stopped（VPN接続中ならIF名は返す）", async () => {
      const controller = new GatewayController("eth0", "eth0", makeRecordingRunNft().runNft);
      await controller.applySettings({ transparentGatewayEnabled: false, killSwitch: true });
      await controller.updateVpnInterface("tun0");
      expect(controller.getStatus()).toEqual({ state: "stopped", vpnInterface: "tun0", killSwitchBlocking: false });
    });

    it("有効設定でlanIface未設定は unconfigured", async () => {
      const controller = new GatewayController(undefined, undefined, makeRecordingRunNft().runNft);
      await controller.applySettings(enabledKs);
      expect(controller.getStatus().state).toBe("unconfigured");
    });

    it("有効・VPN未接続・killSwitch=true は active かつ killSwitchBlocking=true", async () => {
      const controller = new GatewayController("eth0", "eth0", makeRecordingRunNft().runNft);
      await controller.applySettings(enabledKs);
      expect(controller.getStatus()).toEqual({ state: "active", killSwitchBlocking: true });
    });

    it("有効・VPN未接続・killSwitch=false は active かつ遮断なし（フェイルオープン）", async () => {
      const controller = new GatewayController("eth0", "eth0", makeRecordingRunNft().runNft);
      await controller.applySettings({ transparentGatewayEnabled: true, killSwitch: false });
      expect(controller.getStatus()).toEqual({ state: "active", killSwitchBlocking: false });
    });

    it("有効・VPN接続中は active・遮断なしでIF名を返し、切断すると遮断中になる", async () => {
      const controller = new GatewayController("eth0", "eth0", makeRecordingRunNft().runNft);
      await controller.applySettings(enabledKs);
      await controller.updateVpnInterface("tun0");
      expect(controller.getStatus()).toEqual({ state: "active", vpnInterface: "tun0", killSwitchBlocking: false });
      await controller.updateVpnInterface(undefined);
      expect(controller.getStatus()).toEqual({ state: "active", killSwitchBlocking: true });
    });

    it("直近のnft適用が失敗していれば error（activeと断定しない）", async () => {
      const runNft = async (): Promise<NftResult> => ({ exitCode: 1, stdout: "", stderr: "boom" });
      const controller = new GatewayController("eth0", "eth0", runNft);
      await controller.applySettings(enabledKs);
      expect(controller.getStatus().state).toBe("error");
    });
  });
});
