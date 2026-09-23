// 責務: parseInterfaceIpv4Cidr・toNetworkCidr（純粋パース）・getLanSubnetCidr（`ip`コマンド実行）の単体テスト。
// getLanSubnetCidrは実`ip`バイナリに依存せず、IP_BIN環境変数でスタブスクリプトに差し替えて検証する
// （tunnel-interface.test.tsと同様の方針）。

import { describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdtempSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseInterfaceIpv4Cidr, toNetworkCidr } from "./lan-subnet.js";

describe("parseInterfaceIpv4Cidr", () => {
  it("ip -4 -o addr showの標準出力からホストCIDRを抽出する", () => {
    const output =
      "2: eth0    inet 192.168.3.240/24 brd 192.168.3.255 scope global eth0\\       valid_lft forever preferred_lft forever\n";
    expect(parseInterfaceIpv4Cidr(output)).toBe("192.168.3.240/24");
  });

  it("inetトークンが見当たらない場合はundefinedを返す", () => {
    expect(parseInterfaceIpv4Cidr("")).toBeUndefined();
  });
});

describe("toNetworkCidr", () => {
  it.each([
    ["192.168.3.240/24", "192.168.3.0/24"],
    ["10.0.5.130/16", "10.0.0.0/16"],
    ["192.168.3.1/32", "192.168.3.1/32"],
    ["192.168.3.1/0", "0.0.0.0/0"],
  ])("%s のネットワークアドレスは %s", (hostCidr, expected) => {
    expect(toNetworkCidr(hostCidr)).toBe(expected);
  });

  it.each(["192.168.3.240", "192.168.3.240/33", "not-an-ip/24"])("不正な形式 %j はundefinedを返す", (invalid) => {
    expect(toNetworkCidr(invalid)).toBeUndefined();
  });
});

describe("getLanSubnetCidr", () => {
  function stubIpScript(dir: string, body: string): string {
    const scriptPath = join(dir, "ip-stub.sh");
    writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`);
    chmodSync(scriptPath, 0o755);
    return scriptPath;
  }

  it("LAN側インターフェースのIPv4アドレスからネットワークCIDRを取得する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    process.env.IP_BIN = stubIpScript(
      dir,
      "echo '2: eth0    inet 192.168.3.240/24 brd 192.168.3.255 scope global eth0\\\\       valid_lft forever preferred_lft forever'\nexit 0",
    );

    vi.resetModules();
    const { getLanSubnetCidr } = await import("./lan-subnet.js");
    expect(await getLanSubnetCidr("eth0")).toBe("192.168.3.0/24");
  });

  it("LAN_IFACE未設定（undefined）の場合はipコマンドを実行せずundefinedを返す", async () => {
    vi.resetModules();
    const { getLanSubnetCidr } = await import("./lan-subnet.js");
    expect(await getLanSubnetCidr(undefined)).toBeUndefined();
  });

  it("ipコマンドが非ゼロ終了した場合はundefinedを返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    process.env.IP_BIN = stubIpScript(dir, "echo 'error' 1>&2\nexit 1");

    vi.resetModules();
    const { getLanSubnetCidr } = await import("./lan-subnet.js");
    expect(await getLanSubnetCidr("eth0")).toBeUndefined();
  });
});
