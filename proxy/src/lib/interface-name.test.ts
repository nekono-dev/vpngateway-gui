// 責務: isValidInterfaceName（インターフェース名の形式検証）の単体テスト。

import { describe, expect, it } from "vitest";
import { isValidInterfaceName } from "./interface-name.js";

describe("isValidInterfaceName", () => {
  it("妥当なインターフェース名を許可する", () => {
    expect(isValidInterfaceName("eth0")).toBe(true);
    expect(isValidInterfaceName("tun0")).toBe(true);
    expect(isValidInterfaceName("wg0")).toBe(true);
    expect(isValidInterfaceName("br-abc123")).toBe(true);
  });

  it("空文字列やIFNAMSIZ超過（16文字以上）を拒否する", () => {
    expect(isValidInterfaceName("")).toBe(false);
    expect(isValidInterfaceName("a".repeat(16))).toBe(false);
  });

  it("シェルメタ文字・空白を含む文字列を拒否する（nftルール文字列へのインジェクション対策）", () => {
    expect(isValidInterfaceName("eth0; rm -rf /")).toBe(false);
    expect(isValidInterfaceName('eth0" add rule')).toBe(false);
    expect(isValidInterfaceName("eth0 eth1")).toBe(false);
  });
});
