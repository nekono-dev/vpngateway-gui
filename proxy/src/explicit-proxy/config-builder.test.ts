// 責務: buildExplicitProxyConfig（3proxy設定ファイル生成）の単体テスト。

import { describe, expect, it } from "vitest";
import { buildExplicitProxyConfig } from "./config-builder.js";

describe("buildExplicitProxyConfig", () => {
  it("許可CIDRのallow→全拒否のdeny→socks/proxyの順で出力する", () => {
    const config = buildExplicitProxyConfig({
      allowedCidrs: ["192.168.3.0/24", "10.0.0.0/8"],
      socksPort: 1080,
      httpPort: 3128,
    });
    expect(config.split("\n")).toEqual([
      "auth iponly",
      "allow * 192.168.3.0/24,10.0.0.0/8",
      "deny *",
      "socks -p1080",
      "proxy -p3128",
      "",
    ]);
  });

  it("許可CIDRが空なら例外（全拒否の設定で起動させない）", () => {
    expect(() => buildExplicitProxyConfig({ allowedCidrs: [], socksPort: 1080, httpPort: 3128 })).toThrow(/empty/);
  });

  it("設定行を注入できるCIDR（改行入り）は例外", () => {
    expect(() =>
      buildExplicitProxyConfig({ allowedCidrs: ["192.168.3.0/24\nallow * 0.0.0.0/0"], socksPort: 1080, httpPort: 3128 }),
    ).toThrow(/invalid CIDR/);
  });

  it.each([0, 65536, 1.5, Number.NaN])("不正なポート %s は例外", (port) => {
    expect(() => buildExplicitProxyConfig({ allowedCidrs: ["192.168.3.0/24"], socksPort: port, httpPort: 3128 })).toThrow(
      /invalid port/,
    );
  });

  it("SOCKS5とHTTPが同一ポートなら例外", () => {
    expect(() => buildExplicitProxyConfig({ allowedCidrs: ["192.168.3.0/24"], socksPort: 1080, httpPort: 1080 })).toThrow(
      /differ/,
    );
  });
});
