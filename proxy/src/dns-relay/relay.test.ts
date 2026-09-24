// 責務: DNS中継の問い合わせ処理（relay.ts）の単体テスト。上流転送は差し替え、照合・登録・障害時の挙動を検証する。

import { describe, expect, it, vi } from "vitest";
import { ClientIdResolver } from "./client-id.js";
import { parseAnswer } from "./dns-message.js";
import { DnsRelay, type BypassAddress, type DnsRelayConfig } from "./relay.js";
import { buildAnswer, buildQuery } from "./test-helpers.js";

const CONFIG: DnsRelayConfig = {
  excludedDomains: ["example.com", "*.example.org"],
  upstreamUrl: "https://dns.home.example/dns-query",
  upstreamCaPem: "",
  failureMode: "failClosed",
  fallbackServers: [],
};

function createRelay(overrides: { doh?: ReturnType<typeof vi.fn>; plain?: ReturnType<typeof vi.fn>; config?: Partial<DnsRelayConfig> } = {}) {
  const registered: BypassAddress[][] = [];
  const events: string[] = [];
  const doh = overrides.doh ?? vi.fn(async (_url, _ca, query: Buffer) => buildAnswer("example.com", [{ address: "192.0.2.1", ttl: 60 }], 0, query.readUInt16BE(0)));
  const plain = overrides.plain ?? vi.fn(async (_servers, query: Buffer) => buildAnswer("example.com", [{ address: "198.51.100.1", ttl: 30 }], 0, query.readUInt16BE(0)));
  const relay = new DnsRelay({
    clientIds: new ClientIdResolver(["127.0.0.1"], () => ""),
    registerBypass: (addresses) => {
      registered.push([...addresses]);
    },
    onUpstreamStateChange: (state) => events.push(state),
    onFallback: () => events.push("fallback"),
    doh: doh as never,
    plain: plain as never,
  });
  relay.updateConfig({ ...CONFIG, ...overrides.config });
  return { relay, registered, events, doh, plain };
}

describe("DnsRelay", () => {
  it("迂回対象のドメインは、上流の応答のAレコードを登録してから応答を返す", async () => {
    const { relay, registered } = createRelay();
    const response = await relay.handle(buildQuery("example.com"), "192.168.3.25");
    expect(parseAnswer(response!)?.aRecords).toEqual([{ address: "192.0.2.1", ttl: 60 }]);
    expect(registered).toEqual([[{ address: "192.0.2.1", ttl: 60 }]]);
  });

  it("登録（nftのsetへの反映）が終わってから応答を返す（応答を受け取ったクライアントの最初のパケットから迂回するため）", async () => {
    const order: string[] = [];
    const { relay } = createRelay();
    (relay as unknown as { deps: { registerBypass: () => Promise<void> } }).deps.registerBypass = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("registered");
    };
    await relay.handle(buildQuery("example.com"), "192.168.3.25");
    order.push("responded");
    expect(order).toEqual(["registered", "responded"]);
  });

  it("登録が失敗しても、名前解決の応答は返す", async () => {
    const { relay } = createRelay();
    (relay as unknown as { deps: { registerBypass: () => Promise<void> } }).deps.registerBypass = async () => {
      throw new Error("nft failed");
    };
    const response = await relay.handle(buildQuery("example.com"), "192.168.3.25");
    expect(parseAnswer(response!)?.aRecords).toHaveLength(1);
  });

  it("対象外のドメイン（サブドメイン含む）は登録しない", async () => {
    const { relay, registered } = createRelay();
    await relay.handle(buildQuery("www.example.com"), "192.168.3.25");
    await relay.handle(buildQuery("example.org"), "192.168.3.25");
    expect(registered).toEqual([]);
  });

  it("ワイルドカードに一致するサブドメインは登録する", async () => {
    const { relay, registered } = createRelay();
    await relay.handle(buildQuery("a.example.org"), "192.168.3.25");
    expect(registered).toHaveLength(1);
  });

  it("NOERRORでない応答（NXDOMAINやフィルタのブロック応答）は登録しない", async () => {
    const doh = vi.fn(async (_u, _c, query: Buffer) => buildAnswer("example.com", [], 3, query.readUInt16BE(0)));
    const { relay, registered } = createRelay({ doh });
    const response = await relay.handle(buildQuery("example.com"), "192.168.3.25");
    expect(parseAnswer(response!)?.rcode).toBe(3);
    expect(registered).toEqual([]);
  });

  it("上流へ、クライアントのIPから作ったClientIDを渡す", async () => {
    const { relay, doh } = createRelay();
    await relay.handle(buildQuery("example.com"), "192.168.3.25");
    expect(doh.mock.calls[0][3]).toBe("ip-192-168-3-25");
    await relay.handle(buildQuery("example.com"), "127.0.0.1");
    expect(doh.mock.calls[1][3]).toBe("explicit-proxy");
  });

  it("フェイルクローズ: 上流が失敗したらSERVFAILを返し、登録しない", async () => {
    const doh = vi.fn(async () => {
      throw new Error("down");
    });
    const { relay, registered, events } = createRelay({ doh });
    const response = await relay.handle(buildQuery("example.com"), "192.168.3.25");
    expect(parseAnswer(response!)?.rcode).toBe(2);
    expect(registered).toEqual([]);
    expect(events).toEqual(["failing"]);
    expect(relay.getUpstreamState()).toBe("failing");
  });

  it("フォールバック: 上流が失敗したら設定した公開DNSの応答を返し、迂回対象なら登録する", async () => {
    const doh = vi.fn(async () => {
      throw new Error("down");
    });
    const { relay, registered, events, plain } = createRelay({
      doh,
      config: { failureMode: "fallback", fallbackServers: ["1.1.1.1"] },
    });
    const response = await relay.handle(buildQuery("example.com"), "192.168.3.25");
    expect(parseAnswer(response!)?.aRecords[0].address).toBe("198.51.100.1");
    expect(plain.mock.calls[0][0]).toEqual(["1.1.1.1"]);
    expect(registered).toHaveLength(1);
    expect(events).toContain("fallback");
  });

  it("上流の状態は変化したときだけ通知し、復旧も通知する", async () => {
    let fail = true;
    const doh = vi.fn(async (_u, _c, query: Buffer) => {
      if (fail) throw new Error("down");
      return buildAnswer("example.com", [], 0, query.readUInt16BE(0));
    });
    const { relay, events } = createRelay({ doh });
    await relay.handle(buildQuery("example.com"), "192.168.3.25");
    await relay.handle(buildQuery("example.com"), "192.168.3.25");
    fail = false;
    await relay.handle(buildQuery("example.com"), "192.168.3.25");
    expect(events).toEqual(["failing", "ok"]);
  });

  it("上流URLが未設定なら、フォールバック先を通常の上流として使う", async () => {
    const { relay, doh, plain } = createRelay({ config: { upstreamUrl: "", fallbackServers: ["9.9.9.9"] } });
    await relay.handle(buildQuery("example.com"), "192.168.3.25");
    expect(doh).not.toHaveBeenCalled();
    expect(plain).toHaveBeenCalled();
  });

  it("形式が不正なクエリには応答しない", async () => {
    const { relay } = createRelay();
    expect(await relay.handle(Buffer.alloc(3), "192.168.3.25")).toBeUndefined();
  });
});
