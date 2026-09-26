// 責務: isIpv4Cidr（IPv4 CIDR表記の妥当性判定）・isIpv4InCidr（範囲の包含判定）の単体テスト。

import { describe, expect, it } from "vitest";
import { isIpv4Cidr, isIpv4InCidr } from "./ipv4-cidr.js";

describe("isIpv4Cidr", () => {
  it.each(["192.168.3.0/24", "10.0.0.0/8", "0.0.0.0/0", "192.168.3.10/32"])("%s は妥当", (value) => {
    expect(isIpv4Cidr(value)).toBe(true);
  });

  it.each([
    "192.168.3.0", // プレフィックス長なし
    "192.168.3.0/33",
    "192.168.256.0/24",
    "192.168.3/24",
    "::1/128", // IPv6は対象外
    " 192.168.3.0/24",
    "192.168.3.0/24\n",
    "192.168.3.0/24\ndeny *", // 設定ファイルへの行注入
    "",
  ])("%j は不正", (value) => {
    expect(isIpv4Cidr(value)).toBe(false);
  });
});

describe("isIpv4InCidr", () => {
  it("範囲内ならtrue、範囲外ならfalse（/0・/32を含む）", () => {
    expect(isIpv4InCidr("192.168.3.240", "192.168.3.0/24")).toBe(true);
    expect(isIpv4InCidr("192.168.4.1", "192.168.3.0/24")).toBe(false);
    expect(isIpv4InCidr("10.1.2.3", "0.0.0.0/0")).toBe(true);
    expect(isIpv4InCidr("10.0.0.5", "10.0.0.5/32")).toBe(true);
    expect(isIpv4InCidr("10.0.0.6", "10.0.0.5/32")).toBe(false);
    expect(isIpv4InCidr("200.1.1.1", "128.0.0.0/1")).toBe(true);
  });

  it("形式が不正ならfalse", () => {
    expect(isIpv4InCidr("192.168.3.999", "192.168.3.0/24")).toBe(false);
    expect(isIpv4InCidr("192.168.3.1", "192.168.3.0")).toBe(false);
  });
});
