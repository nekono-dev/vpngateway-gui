// 責務: 出口IPの取得（egress-probe.ts）の単体テスト。curlは環境変数CURL_BINでスタブへ差し替える。

import { describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCurlArgs, parseEgressBody } from "./egress-probe.js";

function stubCurl(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
  const path = join(dir, "curl-stub.sh");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("parseEgressBody", () => {
  it("前後の空白・改行を除いたIPv4アドレスのみを受け付ける", () => {
    expect(parseEgressBody("203.0.113.24\n")).toBe("203.0.113.24");
    expect(parseEgressBody("2001:db8::1")).toBeUndefined();
    expect(parseEgressBody('{"ip":"203.0.113.24"}')).toBeUndefined();
    expect(parseEgressBody("300.1.1.1")).toBeUndefined();
  });
});

describe("buildCurlArgs", () => {
  it("経路（インターフェース・プロキシ）を指定し、IPv4・タイムアウト付きで、URLは`--`の後に置く", () => {
    expect(buildCurlArgs("https://api.ipify.org", { interface: "tun0" })).toEqual([
      "-sS", "-4", "--max-time", "8", "--interface", "tun0", "--", "https://api.ipify.org",
    ]);
    expect(buildCurlArgs("https://api.ipify.org", { proxy: "socks5h://192.168.3.240:1080" })).toContain("socks5h://192.168.3.240:1080");
  });
});

describe("fetchEgressIp", () => {
  it("成功時はIP、失敗時はエラーの1行目、本文がIPv4でなければその旨を返す", async () => {
    process.env.CURL_BIN = stubCurl('echo "203.0.113.24"');
    vi.resetModules();
    let { fetchEgressIp } = await import("./egress-probe.js");
    expect(await fetchEgressIp("https://api.ipify.org", { interface: "tun0" })).toEqual({ ok: true, ip: "203.0.113.24" });

    process.env.CURL_BIN = stubCurl('echo "curl: (28) Connection timed out" >&2\nexit 28');
    vi.resetModules();
    ({ fetchEgressIp } = await import("./egress-probe.js"));
    expect(await fetchEgressIp("https://api.ipify.org", { interface: "tun0" })).toEqual({ ok: false, error: "curl: (28) Connection timed out" });

    process.env.CURL_BIN = stubCurl('echo "<html>"');
    vi.resetModules();
    ({ fetchEgressIp } = await import("./egress-probe.js"));
    expect(await fetchEgressIp("https://api.ipify.org", { interface: "tun0" })).toEqual({ ok: false, error: "応答本文がIPv4アドレスではない" });
  });
});
