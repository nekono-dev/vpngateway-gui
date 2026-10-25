// 責務: DNS中継リゾルバ（クライアント識別・上流障害時の切り替え・転送の打ち切り・ログの秘匿）の受け入れテスト。
// 受け入れ条件 proxyserver/AC-8・AC-9・AC-20・AC-21 を確認する。

import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:https";
import { readdirSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { LOCAL_CLIENT_ID, SELF_CHECK_CLIENT_ID, ClientIdResolver, buildClientId } from "../../proxy/src/dns-relay/client-id.js";
import { parseAnswer, RCODE_SERVFAIL } from "../../proxy/src/dns-relay/dns-message.js";
import { DnsRelay, type DnsRelayConfig } from "../../proxy/src/dns-relay/relay.js";
import { UPSTREAM_TIMEOUT_MS, forwardDoh } from "../../proxy/src/dns-relay/upstream.js";
import { buildAnswer, buildQuery } from "../../proxy/src/dns-relay/test-helpers.js";
import { createTestPki } from "../helpers/pki.js";
import { repoPath } from "../helpers/repo.js";

const CONFIG: DnsRelayConfig = {
  excludedDomains: ["example.com"],
  upstreamUrl: "https://dns.home.example/dns-query",
  upstreamCaPem: "",
  failureMode: "failClosed",
  fallbackServers: [],
  clientNameServers: [],
};

/** 目的: 上流の転送関数を差し替えた中継リゾルバを作る。 */
function createRelay(config: Partial<DnsRelayConfig>, doh: ReturnType<typeof vi.fn>, plain: ReturnType<typeof vi.fn>) {
  const states: Array<string | undefined> = [];
  const relay = new DnsRelay({
    registerBypass: () => undefined,
    onUpstreamStateChange: (state, detail) => states.push(`${state}:${detail ?? ""}`),
    onFallback: () => states.push("fallback"),
    doh: doh as never,
    plain: plain as never,
  });
  relay.updateConfig({ ...CONFIG, ...config });
  return { relay, states };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DNS中継", () => {
  it("proxyserver/AC-8: クライアントの識別子は、名前が得られなければIPアドレスから、得られればその名前から作られる", async () => {
    expect(buildClientId("192.168.3.25", undefined)).toBe("192-168-3-25");
    expect(buildClientId("192.168.3.25", "Macmini.lan.")).toBe("macmini-lan");
    // 名前の整形: 英数字以外の連続は1つのハイフンになり、63文字以内に収まる。
    expect(buildClientId("192.168.3.25", `My  Phone__${"x".repeat(80)}`).length).toBeLessThanOrEqual(63);
    expect(buildClientId("192.168.3.25", "My  Phone")).toBe("my-phone");
    // ゲートウェイ自身と検証用の送信元は固定の識別子になる。
    const resolver = new ClientIdResolver(["127.0.0.1"], async (ip) => (ip === "192.168.3.30" ? "Laptop.lan." : undefined));
    expect(await resolver.resolve("127.0.0.1")).toBe(LOCAL_CLIENT_ID);
    expect(await resolver.resolve("127.0.0.2")).toBe(SELF_CHECK_CLIENT_ID);
    expect(await resolver.resolve("192.168.3.30")).toBe("laptop-lan");
    expect(await resolver.resolve("192.168.3.31")).toBe("192-168-3-31");
  });

  it("proxyserver/AC-9: 上流が失敗すると、遮断の設定では失敗応答を返し、切り替えの設定では公開DNSの応答を返す", async () => {
    const failingDoh = vi.fn(async () => {
      throw new Error("upstream status 500");
    });
    const plain = vi.fn(async (_servers: readonly string[], query: Buffer) =>
      buildAnswer("www.example.net", [{ address: "198.51.100.1", ttl: 30 }], 0, query.readUInt16BE(0)),
    );
    // 遮断の設定: 公開DNSへは転送せず、SERVFAILを返す。
    const closed = createRelay({ failureMode: "failClosed" }, failingDoh, plain);
    const closedResponse = await closed.relay.handle(buildQuery("www.example.net"), "192.168.3.25");
    expect(parseAnswer(closedResponse as Buffer)?.rcode).toBe(RCODE_SERVFAIL);
    expect(plain).not.toHaveBeenCalled();
    // 切り替えの設定: 指定した公開DNSへ転送し、その応答を返す。
    const fallback = createRelay({ failureMode: "fallback", fallbackServers: ["9.9.9.9"] }, failingDoh, plain);
    const fallbackResponse = await fallback.relay.handle(buildQuery("www.example.net"), "192.168.3.25");
    expect(parseAnswer(fallbackResponse as Buffer)?.aRecords).toEqual([{ address: "198.51.100.1", ttl: 30 }]);
    expect(plain).toHaveBeenCalledWith(["9.9.9.9"], expect.any(Buffer));
    expect(fallback.states).toContain("fallback");
  });

  it("proxyserver/AC-20: 上流への転送の待機上限は5000ミリ秒であり、応答しない上流は5秒で失敗として扱われる", async () => {
    expect(UPSTREAM_TIMEOUT_MS).toBe(5000);
    // 接続は受け付けるが、応答を返さない上流のDoHサーバ。
    const pki = createTestPki("stall");
    const server = createServer({ key: readFileSync(pki.serverKey), cert: readFileSync(pki.serverCert) }, () => {
      // 応答しない。
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const started = Date.now();
      await expect(
        forwardDoh(`https://127.0.0.1:${port}/dns-query`, readFileSync(pki.caCert, "utf8"), buildQuery("example.com"), "client"),
      ).rejects.toThrow();
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(4500);
      expect(elapsed).toBeLessThan(8000);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }, 15000);

  it("proxyserver/AC-21: 中継した問い合わせのドメイン名とクライアントのIPアドレスが、ゲートウェイのログへ出力されない", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    }
    const secretDomain = "secret-host.example.com";
    const secretClient = "192.168.77.88";
    const failingDoh = vi.fn(async () => {
      throw new Error("upstream status 503");
    });
    const plain = vi.fn(async (_servers: readonly string[], query: Buffer) =>
      buildAnswer(secretDomain, [{ address: "198.51.100.9", ttl: 30 }], 0, query.readUInt16BE(0)),
    );
    const { relay, states } = createRelay({ failureMode: "fallback", fallbackServers: ["9.9.9.9"] }, failingDoh, plain);
    await relay.handle(buildQuery(secretDomain), secretClient);
    const observed = [...lines, ...states].join("\n");
    expect(observed).not.toContain(secretDomain);
    expect(observed).not.toContain(secretClient);
    // 実装側にも、問い合わせの内容を出力する処理が無い。
    const dir = repoPath("proxy/src/dns-relay");
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "test-helpers.ts")) {
      expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/console\.(log|info|warn|error|debug)\(/);
    }
  });
});
