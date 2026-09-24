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

describe("buildGatewayRuleset: ドメイン迂回・DNSリダイレクト", () => {
  const T = GATEWAY_TABLE_NAME;
  const base = { lanIface: "eth0", wanIface: "eth0", vpnIface: "tun0", killSwitch: true } as const;

  it("迂回: setとfwmarkのチェーンを作り、既存要素を同じスクリプトで入れる（再構成で失われない）", () => {
    const script = buildGatewayRuleset({
      ...base,
      bypass: { entries: [{ address: "192.0.2.1", timeoutSeconds: 120 }, { address: "192.0.2.2", timeoutSeconds: 61 }], explicitProxyUid: undefined },
    });
    expect(script).toContain(`add set inet ${T} bypass4 { type ipv4_addr ; flags timeout ; }`);
    expect(script).toContain(`add element inet ${T} bypass4 { 192.0.2.1 timeout 120s, 192.0.2.2 timeout 61s }`);
    expect(script).toContain(`bypass_mark iifname "eth0" ip daddr @bypass4 meta mark set 256 ct mark set 256`);
    // 明示的プロキシ用のoutputチェーンはUID未指定なら作らない。
    expect(script).not.toContain("bypass_mark_output");
  });

  it("迂回: マーク付きの通信は、Kill Switch ONでも末尾のdropより前で許可し、実回線側でマスカレードする", () => {
    const lines = buildGatewayRuleset({ ...base, vpnIface: undefined, bypass: { entries: [], explicitProxyUid: undefined } }).split("\n");
    const accept = lines.indexOf(`add rule inet ${T} forward ct mark 256 accept`);
    const drop = lines.indexOf(`add rule inet ${T} forward iifname "eth0" drop`);
    expect(accept).toBeGreaterThan(-1);
    expect(accept).toBeLessThan(drop);
    expect(lines).toContain(`add rule inet ${T} postrouting meta mark 256 oifname "eth0" masquerade`);
  });

  it("迂回: 明示的プロキシのUIDを指定すると、ホスト自身の発信（output）にもマークを付ける", () => {
    const script = buildGatewayRuleset({ ...base, bypass: { entries: [], explicitProxyUid: 10001 } });
    expect(script).toContain(`add chain inet ${T} bypass_mark_output { type route hook output priority -150 ; }`);
    expect(script).toContain("bypass_mark_output meta skuid 10001 ip daddr @bypass4 meta mark set 256");
  });

  it("迂回を指定しなければ、setもマークも作らない（従来のルールセットと同一）", () => {
    const script = buildGatewayRuleset(base);
    expect(script).not.toContain("bypass");
    expect(script).not.toContain("ct mark");
  });

  it("透過ゲートウェイ無効: 転送・Kill Switchのチェーンを作らず、迂回の要素だけを持つテーブルにする", () => {
    const script = buildGatewayRuleset({
      ...base,
      transparentGateway: false,
      bypass: { entries: [], explicitProxyUid: 10001 },
    });
    expect(script).toContain("bypass_mark_output");
    expect(script).not.toContain("forward");
    // 実回線側でのマスカレードは、迂回する通信（マーク付き）のみ。トンネル・WAN向けのマスカレードは作らない。
    const masquerades = script.split("\n").filter((line) => line.includes("masquerade"));
    expect(masquerades).toEqual([`add rule inet ${T} postrouting meta mark 256 oifname "eth0" masquerade`]);
  });

  it("DNSリダイレクト: 宛先53番（UDP/TCP）を中継リゾルバへDNATし、ゲートウェイ自身と除外CIDR宛は対象外にする", () => {
    const script = buildGatewayRuleset({
      ...base,
      dnsRedirect: { listenAddress: "192.168.3.240", port: 53, excludedCidrs: ["192.168.3.5/32", "10.0.0.0/8"] },
    });
    expect(script).toContain(`add chain inet ${T} dns_redirect { type nat hook prerouting priority -100 ; }`);
    expect(script).toContain(
      `dns_redirect iifname "eth0" meta l4proto { udp, tcp } th dport 53 ip daddr != { 192.168.3.240, 192.168.3.5/32, 10.0.0.0/8 } dnat ip to 192.168.3.240:53`,
    );
  });

  it("不正な値（アドレス・期限・CIDR・UID・ポート）は、ルール文字列へ埋め込まず例外にする", () => {
    const build = (extra: object) => () => buildGatewayRuleset({ ...base, ...extra });
    expect(build({ bypass: { entries: [{ address: "1.2.3.4 }; flush ruleset", timeoutSeconds: 10 }], explicitProxyUid: undefined } })).toThrow(/invalid bypass entry/);
    expect(build({ bypass: { entries: [{ address: "1.2.3.4", timeoutSeconds: 0 }], explicitProxyUid: undefined } })).toThrow(/invalid bypass entry/);
    expect(build({ bypass: { entries: [], explicitProxyUid: -1 } })).toThrow(/invalid uid/);
    expect(build({ dnsRedirect: { listenAddress: "1.2.3.4", port: 0, excludedCidrs: [] } })).toThrow(/invalid port/);
    expect(build({ dnsRedirect: { listenAddress: "1.2.3.4", port: 53, excludedCidrs: ["10.0.0.0/8\nflush ruleset"] } })).toThrow(/invalid CIDR/);
    expect(build({ dnsRedirect: { listenAddress: "x", port: 53, excludedCidrs: [] } })).toThrow(/invalid listen address/);
  });
});
