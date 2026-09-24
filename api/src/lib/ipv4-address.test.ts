// 責務: isIpv4Address（IPv4アドレス表記の判定）の単体テスト。

import { describe, expect, it } from "vitest";
import { isIpv4Address } from "./ipv4-address.js";

describe("isIpv4Address", () => {
  it("妥当なIPv4アドレスはtrue", () => {
    expect(isIpv4Address("1.1.1.1")).toBe(true);
    expect(isIpv4Address("192.168.3.240")).toBe(true);
  });

  it("範囲外・桁不足・CIDR・空白・改行入りはfalse", () => {
    for (const value of ["256.1.1.1", "1.1.1", "1.1.1.1/32", " 1.1.1.1", "1.1.1.1\n", "a.b.c.d", ""]) {
      expect(isIpv4Address(value)).toBe(false);
    }
  });
});
