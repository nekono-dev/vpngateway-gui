// 責務: 設定の動作検証（構成の照合・検証用の名前・誘導の判定）の受け入れテスト。
// 受け入れ条件 proxyserver/AC-13・AC-14 を、実機のnft出力の例と、時計を差し替えた記録で確認する。

import { describe, expect, it } from "vitest";
import { parseTableListing } from "../../proxy/src/verification/nft-listing.js";
import { CheckNonceRegistry } from "../../proxy/src/verification/check-nonces.js";
import { wasJustRedirected } from "../../proxy/src/verification/redirect-record.js";
import { auditGatewayRules, auditKillSwitchRules } from "../../proxy/src/verification/rule-audit.js";
import { SAMPLE_LISTING } from "../../proxy/src/verification/test-fixtures.js";

const connected = { lanIface: "eth0", wanIface: "eth0", vpnIface: "tun0", killSwitch: true, ipForwardEnabled: true };

describe("設定の動作検証", () => {
  it("proxyserver/AC-13: 構成の照合は、設定どおりのルールを合格とし、遮断規則の欠落を不合格とする", () => {
    const chains = parseTableListing(SAMPLE_LISTING);
    expect(auditGatewayRules(chains, connected).status).toBe("pass");
    expect(auditKillSwitchRules(chains, connected).status).toBe("pass");
    // 転送の末尾の遮断規則を取り除くと不合格になり、欠けているものが示される。
    const withoutDrop = new Map([...chains].map(([name, rules]) => [name, rules.filter((rule) => rule !== 'iifname "eth0" drop')]));
    const gateway = auditGatewayRules(withoutDrop, connected);
    expect(gateway.status).toBe("fail");
    expect(gateway.observed).toContain("遮断ルール");
    expect(auditKillSwitchRules(withoutDrop, connected).status).toBe("fail");
    // テーブル自体が無い場合も不合格になる。
    expect(auditGatewayRules(undefined, connected).status).toBe("fail");
  });

  it("proxyserver/AC-14: 検証用の名前は、期限内の受信と誘導の有無だけを記録し、送信元の情報を保持しない", () => {
    let clock = 0;
    const registry = new CheckNonceRegistry(() => clock);
    const name = "vpngw-abcdef123456.example.com";
    registry.register(name, 60);
    expect(registry.has(name)).toBe(true);
    expect(registry.get(name)).toEqual({ received: false, redirected: false });
    registry.markReceived(name, true);
    // 記録の形は、受信と誘導の有無だけである（送信元のIPや名前を含まない）。
    expect(registry.get(name)).toEqual({ received: true, redirected: true });
    expect(Object.keys(registry.get(name) ?? {}).sort()).toEqual(["received", "redirected"]);
    // 期限を過ぎると、登録も記録も無くなる。
    clock = 61_000;
    expect(registry.has(name)).toBe(false);
    expect(registry.get(name)).toBeUndefined();
    // 誘導の直後の判定: 残り期限が（10分 − 5秒）以上のときだけ「直前に誘導された」とみなす。
    expect(wasJustRedirected([{ address: "192.168.3.20", expiresSeconds: 599 }], "192.168.3.20")).toBe(true);
    expect(wasJustRedirected([{ address: "192.168.3.20", expiresSeconds: 300 }], "192.168.3.20")).toBe(false);
    expect(wasJustRedirected([{ address: "192.168.3.21", expiresSeconds: 599 }], "192.168.3.20")).toBe(false);
  });
});
