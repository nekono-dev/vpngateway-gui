// 責務: isIpv4Cidr（IPv4 CIDR表記の妥当性判定）の単体テスト。

import { describe, expect, it } from "vitest";
import { isIpv4Cidr } from "./ipv4-cidr.js";

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
