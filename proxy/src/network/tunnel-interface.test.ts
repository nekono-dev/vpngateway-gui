// 責務: parseRouteGetInterface（純粋パース）・getEgressInterface（`ip route get`実行）の単体テスト。
// getEgressInterfaceは実`ip`バイナリに依存せず、IP_BIN環境変数でスタブスクリプトに差し替えて検証する
// （command-runner.test.tsと同様、実バイナリの代わりにshスクリプトで挙動を再現する方針）。

import { describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdtempSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRouteGetInterface } from "./tunnel-interface.js";

describe("parseRouteGetInterface", () => {
  it("通常経路（ゲートウェイ経由）からインターフェース名を抽出する", () => {
    const output = "1.1.1.1 via 192.0.2.1 dev eth0 src 192.0.2.10 uid 1000\n    cache\n";
    expect(parseRouteGetInterface(output)).toBe("eth0");
  });

  it("ポリシールーティング（専用テーブル経由、AdGuard VPN CLIの実機出力）からトンネルIF名を抽出する", () => {
    const output = "1.1.1.1 dev tun0 table 880 src 172.16.219.2 uid 0\n    cache\n";
    expect(parseRouteGetInterface(output)).toBe("tun0");
  });

  it("空出力の場合はundefinedを返す", () => {
    expect(parseRouteGetInterface("")).toBeUndefined();
  });

  it("devトークンが見当たらない不正な形式の場合はundefinedを返す", () => {
    expect(parseRouteGetInterface("RTNETLINK answers: Network is unreachable\n")).toBeUndefined();
  });
});

describe("getEgressInterface", () => {
  function stubIpScript(dir: string, body: string): string {
    const scriptPath = join(dir, "ip-stub.sh");
    writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`);
    chmodSync(scriptPath, 0o755);
    return scriptPath;
  }

  it("ip route getの標準出力からインターフェース名を取得する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    process.env.IP_BIN = stubIpScript(dir, "echo '1.1.1.1 dev tun0 table 880 src 172.16.219.2 uid 0'\nexit 0");

    vi.resetModules();
    const { getEgressInterface } = await import("./tunnel-interface.js");
    expect(await getEgressInterface()).toBe("tun0");
  });

  it("ipコマンドが非ゼロ終了した場合はundefinedを返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
    process.env.IP_BIN = stubIpScript(dir, "echo 'error' 1>&2\nexit 1");

    vi.resetModules();
    const { getEgressInterface } = await import("./tunnel-interface.js");
    expect(await getEgressInterface()).toBeUndefined();
  });
});
