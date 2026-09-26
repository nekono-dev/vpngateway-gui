// 責務: 構成の照合（rule-audit.ts）の単体テスト。実機のnftの出力形式（nft-listing.test.tsの抜粋）を用いる。

import { describe, expect, it } from "vitest";
import { parseTableListing } from "./nft-listing.js";
import { SAMPLE_LISTING } from "./test-fixtures.js";
import { auditDnsRedirectRules, auditGatewayRules, auditKillSwitchRules, hasBypassMarkRule } from "./rule-audit.js";

const chains = parseTableListing(SAMPLE_LISTING);
const connected = { lanIface: "eth0", wanIface: "eth0", vpnIface: "tun0", killSwitch: true, ipForwardEnabled: true };

function without(line: string): Map<string, string[]> {
  return new Map([...chains].map(([name, rules]) => [name, rules.filter((rule) => !rule.includes(line))]));
}

describe("auditGatewayRules", () => {
  it("VPN接続中: トンネルへのNAT・転送許可・末尾のdrop・IPフォワーディングがあれば合格", () => {
    expect(auditGatewayRules(chains, connected).status).toBe("pass");
  });

  it("トンネルへの転送許可が無い、IPフォワーディングが無効なら不合格で、欠けているものを示す", () => {
    const outcome = auditGatewayRules(without('iifname "eth0" oifname "tun0" accept'), { ...connected, ipForwardEnabled: false });
    expect(outcome.status).toBe("fail");
    expect(outcome.observed).toContain("LANからVPNトンネル（tun0）への転送許可が無い");
    expect(outcome.observed).toContain("IPフォワーディングが無効");
    expect(outcome.hint).toContain("net.ipv4.ip_forward=1");
  });

  it("テーブルが無い、LAN側インターフェースが未設定なら不合格", () => {
    expect(auditGatewayRules(undefined, connected).status).toBe("fail");
    expect(auditGatewayRules(chains, { ...connected, lanIface: undefined }).observed).toBe("LAN側インターフェースが未設定");
  });

  it("VPN未接続: 末尾のdropがあれば合格（遮断中である旨を示す）", () => {
    const outcome = auditGatewayRules(chains, { ...connected, vpnIface: undefined });
    expect(outcome.status).toBe("pass");
    expect(outcome.observed).toContain("遮断中");
  });
});

describe("auditKillSwitchRules", () => {
  it("末尾のdropがあり、LANから実回線へ抜ける許可が無ければ合格", () => {
    expect(auditKillSwitchRules(chains, connected).status).toBe("pass");
  });

  it("末尾のdropが無ければ不合格", () => {
    expect(auditKillSwitchRules(without('iifname "eth0" drop'), connected).status).toBe("fail");
  });

  it("LANから実回線へ直接抜ける許可（フェイルオープン）があれば不合格", () => {
    const failOpen = new Map(chains);
    const forward = [...(chains.get("forward") ?? [])];
    forward.splice(forward.length - 1, 0, 'iifname "eth0" oifname "eth0" accept');
    failOpen.set("forward", forward);
    const outcome = auditKillSwitchRules(failOpen, connected);
    expect(outcome.status).toBe("fail");
    expect(outcome.observed).toContain("実回線へ直接抜ける許可がある");
  });
});

describe("auditDnsRedirectRules", () => {
  const input = {
    lanIface: "eth0",
    relayActive: true,
    redirect: { listenAddress: "192.168.3.240", port: 53, excludedCidrs: ["192.168.3.5/32"] },
  };

  it("誘導・記録・除外（nftが/32を省略した表記）を満たせば合格", () => {
    const outcome = auditDnsRedirectRules(chains, input);
    expect(outcome.status).toBe("pass");
    expect(outcome.observed).toBe("53番宛を 192.168.3.240:53 へ誘導（除外 1 件）");
  });

  it("除外が設定と異なる、誘導のルールが無い場合は不合格", () => {
    expect(auditDnsRedirectRules(chains, { ...input, redirect: { ...input.redirect, excludedCidrs: ["10.0.0.0/8"] } }).status).toBe("fail");
    expect(auditDnsRedirectRules(without("dnat ip to"), input).status).toBe("fail");
  });

  it("中継が待受していない、リダイレクトが構成されていない場合は不合格で理由を示す", () => {
    expect(auditDnsRedirectRules(chains, { ...input, relayActive: false }).observed).toContain("待受していない");
    expect(auditDnsRedirectRules(chains, { ...input, redirect: undefined }).observed).toBe("リダイレクトが構成されていない");
  });
});

describe("hasBypassMarkRule", () => {
  it("LAN発の迂回対象宛に印を付けるルールの有無", () => {
    expect(hasBypassMarkRule(chains, "eth0")).toBe(true);
    expect(hasBypassMarkRule(chains, "eth1")).toBe(false);
    expect(hasBypassMarkRule(undefined, "eth0")).toBe(false);
  });
});
