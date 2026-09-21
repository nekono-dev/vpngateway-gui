// 責務: buildGatewayRuleset/buildTeardownScript（nftスクリプト文字列の組み立て）の単体テスト。
// 実nftバイナリには依存しない（純粋な文字列組み立てロジックのみを検証する）。

import { describe, expect, it } from "vitest";
import { buildGatewayRuleset, buildTeardownScript, GATEWAY_TABLE_NAME } from "./ruleset.js";

describe("buildTeardownScript", () => {
  it("専用テーブルの削除コマンドを生成する", () => {
    expect(buildTeardownScript()).toBe(`delete table inet ${GATEWAY_TABLE_NAME}\n`);
  });
});

describe("buildGatewayRuleset", () => {
  const T = GATEWAY_TABLE_NAME;

  it("VPN接続中: トンネル経由のmasquerade・LAN発のforward accept・トンネル側からの新規接続のdropを生成する", () => {
    const script = buildGatewayRuleset({ lanIface: "eth0", wanIface: "eth0", vpnIface: "tun0", killSwitch: true });

    expect(script).toContain(`add table inet ${T}`);
    // 既存テーブルの有無に関わらずエラーにならず原子的に置換できる（add→delete→addの順）。
    expect(script.split("\n").slice(0, 3)).toEqual([
      `add table inet ${T}`,
      `delete table inet ${T}`,
      `add table inet ${T}`,
    ]);
    expect(script).toContain('postrouting oifname "tun0" masquerade');
    expect(script).toContain('forward iifname "eth0" oifname "tun0" accept');
    expect(script).toContain('forward iifname "tun0" oifname "eth0" ct state established,related accept');
    expect(script).toContain('forward iifname "tun0" drop');
    // フェイルオープン用ルール（wanIface宛）は含まれない。
    expect(script).not.toContain('oifname "eth0" masquerade');
  });

  it("forwardチェーンはpolicy acceptで、LAN側から入る転送のみを末尾のdropで遮断する（他のDockerコンテナ等を巻き込まない）", () => {
    for (const input of [
      { vpnIface: "tun0", killSwitch: true },
      { vpnIface: undefined, killSwitch: true },
      { vpnIface: undefined, killSwitch: false },
    ]) {
      const script = buildGatewayRuleset({ lanIface: "eth0", wanIface: "eth0", ...input });
      expect(script).toContain("hook forward priority 0 ; policy accept ;");
      expect(script).not.toContain("policy drop");
      // 末尾（最後のルール）がLAN側発の転送のdropであること。
      const rules = script.trim().split("\n");
      expect(rules[rules.length - 1]).toBe(`add rule inet ${T} forward iifname "eth0" drop`);
    }
  });

  it("VPN未接続・killSwitch=true: LAN発のacceptを一切含まない（LAN発の転送は全てdropされる、フェイルクローズ）", () => {
    const script = buildGatewayRuleset({ lanIface: "eth0", wanIface: "eth0", vpnIface: undefined, killSwitch: true });

    // LAN側インターフェースを入口とするacceptルールが無いこと。
    expect(script).not.toMatch(/iifname "eth0" oifname .* accept/);
    expect(script).not.toContain("masquerade");
  });

  it("どの状態でも、Dockerの公開ポート（DNAT済み）と、同居コンテナ通信の応答方向の確立済み通信は許可する", () => {
    for (const input of [
      { vpnIface: "tun0", killSwitch: true },
      { vpnIface: undefined, killSwitch: true },
      { vpnIface: undefined, killSwitch: false },
    ]) {
      const script = buildGatewayRuleset({ lanIface: "eth0", wanIface: "eth0", ...input });
      expect(script).toContain(`add rule inet ${T} forward ct status dnat accept`);
      expect(script).toContain(
        `add rule inet ${T} forward oifname != "eth0" ct direction reply ct state established,related accept`,
      );
    }
  });

  it("VPN未接続・killSwitch=false: WAN側インターフェースへのフェイルオープンルールを生成する", () => {
    const script = buildGatewayRuleset({ lanIface: "eth0", wanIface: "eth0", vpnIface: undefined, killSwitch: false });

    expect(script).toContain('postrouting oifname "eth0" masquerade');
    expect(script).toContain('forward iifname "eth0" oifname "eth0" accept');
  });

  it("不正なインターフェース名（シェルメタ文字混入等）は例外を投げる", () => {
    expect(() =>
      buildGatewayRuleset({
        lanIface: "eth0; rm -rf /",
        wanIface: "eth0",
        vpnIface: undefined,
        killSwitch: false,
      }),
    ).toThrow(/invalid interface name/);
  });
});
