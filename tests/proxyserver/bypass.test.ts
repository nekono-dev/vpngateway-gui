// 責務: ドメイン迂回（印付け・アドレス変換・保持期限・ドメイン照合）と53番の誘導規則の受け入れテスト。
// 受け入れ条件 proxyserver/AC-6・AC-7・AC-10・AC-19 を、ルールセットの組み立てと純粋関数で確認する。

import { describe, expect, it } from "vitest";
import { BYPASS_GRACE_SECONDS, BypassSet } from "../../proxy/src/network/bypass-set.js";
import { buildGatewayRuleset } from "../../proxy/src/network/ruleset.js";
import { createDomainMatcher } from "../../proxy/src/dns-relay/domain-matcher.js";

const base = { lanIface: "eth0", wanIface: "eth1", vpnIface: "tun0", killSwitch: true };

describe("ドメイン迂回の規則", () => {
  it("proxyserver/AC-6: 迂回対象宛の通信に印を付ける規則とアドレス変換が、LAN発とホスト自身の発信の双方に生成される", () => {
    const script = buildGatewayRuleset({
      ...base,
      bypass: { entries: [{ address: "203.0.113.5", timeoutSeconds: 120 }], explicitProxyUid: 10001 },
    });
    // LAN発: 宛先が迂回setにあれば印（0x100 = 256）を付ける。
    expect(script).toContain('add rule inet vpngwgui bypass_mark iifname "eth0" ip daddr @bypass4 meta mark set 256 ct mark set 256');
    // ホスト自身の発信（明示的プロキシのUID）にも印を付ける。
    expect(script).toContain("add rule inet vpngwgui bypass_mark_output meta skuid 10001 ip daddr @bypass4 meta mark set 256");
    // 印付きで実回線へ出る通信をアドレス変換する。
    expect(script).toContain('add rule inet vpngwgui postrouting meta mark 256 oifname "eth1" masquerade');
    // 印付きの転送は、LAN発を遮断する末尾の規則より前に許可される。
    const forward = script.split("\n").filter((line) => line.startsWith("add rule inet vpngwgui forward "));
    expect(forward.indexOf("add rule inet vpngwgui forward ct mark 256 accept")).toBeGreaterThanOrEqual(0);
    expect(forward.indexOf("add rule inet vpngwgui forward ct mark 256 accept")).toBeLessThan(forward.length - 1);
    // 再構成で失われないよう、保持中の要素を新しいテーブルへ同時に入れる。
    expect(script).toContain("add element inet vpngwgui bypass4 { 203.0.113.5 timeout 120s }");
    // 迂回を設定しなければ、迂回の要素は作らない。
    expect(buildGatewayRuleset({ ...base })).not.toContain("bypass4");
  });

  it("proxyserver/AC-7: 完全一致の表記はそのドメインだけに、ワイルドカードの表記はサブドメインだけに一致する", () => {
    const matches = createDomainMatcher(["example.com", "*.example.org"]);
    expect(matches("example.com")).toBe(true);
    expect(matches("www.example.com")).toBe(false);
    expect(matches("a.b.example.org")).toBe(true);
    expect(matches("example.org")).toBe(false);
    // 大文字小文字は区別せず、末尾のドットは無視する。
    expect(matches("EXAMPLE.com.")).toBe(true);
    // 両方の表記を登録すると、自身とサブドメインの双方が対象になる。
    const both = createDomainMatcher(["example.net", "*.example.net"]);
    expect(both("example.net")).toBe(true);
    expect(both("www.example.net")).toBe(true);
  });

  it("proxyserver/AC-10: 53番の誘導規則は、ゲートウェイ自身と除外のCIDR宛を除いて中継へ変換し、無効のときは生成されない", () => {
    const script = buildGatewayRuleset({
      ...base,
      dnsRedirect: { listenAddress: "192.168.3.240", port: 53, excludedCidrs: ["192.168.3.5/32"] },
    });
    const rule = script.split("\n").find((line) => line.startsWith("add rule inet vpngwgui dns_redirect "));
    expect(rule).toBeDefined();
    expect(rule).toContain('iifname "eth0"');
    expect(rule).toContain("th dport 53");
    expect(rule).toContain("ip daddr != { 192.168.3.240, 192.168.3.5/32 }");
    expect(rule).toContain("dnat ip to 192.168.3.240:53");
    expect(buildGatewayRuleset({ ...base })).not.toContain("dnat ip to");
    // 不正なCIDRは規則へ埋め込まない。
    expect(() =>
      buildGatewayRuleset({ ...base, dnsRedirect: { listenAddress: "192.168.3.240", port: 53, excludedCidrs: ["1.2.3.4/32 accept"] } }),
    ).toThrow();
  });
});

describe("迂回対象のIPアドレスの保持", () => {
  it("proxyserver/AC-19: 迂回対象のIPアドレスの期限は、保持時間に60秒を加えた値になる", () => {
    let clock = 1_000_000;
    const set = new BypassSet(() => clock);
    expect(BYPASS_GRACE_SECONDS).toBe(60);
    expect(set.add([{ address: "203.0.113.5", ttl: 300 }])).toEqual([{ address: "203.0.113.5", timeoutSeconds: 360 }]);
    // 保持時間が0の応答でも、猶予の60秒だけは保持する。
    expect(set.add([{ address: "203.0.113.6", ttl: 0 }])).toEqual([{ address: "203.0.113.6", timeoutSeconds: 60 }]);
    // 時間が経つと残り期限が減り、期限を過ぎた要素は取り除かれる。
    clock += 100_000;
    expect(set.live()).toEqual([{ address: "203.0.113.5", timeoutSeconds: 260 }]);
    // 再応答で期限が更新される。
    set.add([{ address: "203.0.113.5", ttl: 300 }]);
    expect(set.live()[0]?.timeoutSeconds).toBe(360);
  });
});
