// 責務: ゲートウェイで実行する検証項目（gateway-checks.ts）の単体テスト。nft・ip・curl・中継リゾルバは差し替える。

import { describe, expect, it, vi } from "vitest";
import type { DnsAnswer } from "../dns-relay/dns-message.js";
import { parseTableListing } from "./nft-listing.js";
import { SAMPLE_LISTING } from "./test-fixtures.js";
import { probeNameFor, runGatewayCheck, type GatewayCheckDependencies, type GatewayCheckRequest } from "./gateway-checks.js";
import type { GatewayCheckId } from "./check-outcome.js";
import type { SetElement } from "./nft-listing.js";

function answer(addresses: string[], rcode = 0): DnsAnswer {
  return { rcode, truncated: false, aRecords: addresses.map((address) => ({ address, ttl: 60 })), ptrNames: [] };
}

function createDeps(overrides: Partial<GatewayCheckDependencies> = {}): GatewayCheckDependencies {
  return {
    gatewayState: () => ({
      lanIface: "eth0",
      wanIface: "eth0",
      vpnIface: "tun0",
      settings: {
        transparentGatewayEnabled: true,
        killSwitch: true,
        dns: { bypassEnabled: true, redirect: { listenAddress: "192.168.3.240", port: 53, excludedCidrs: ["192.168.3.5/32"] } },
      },
    }),
    relay: () => ({
      status: { state: "active", upstream: "ok", bypassEntries: 1 },
      settings: {
        enabled: true,
        excludedDomains: ["*.bypass.example"],
        upstreamUrl: "https://dns.home.example/dns-query",
        upstreamCaPem: "",
        failureMode: "failClosed",
        fallbackServers: [],
        clientNameServers: [],
      },
      port: 53,
      listenAddresses: ["192.168.3.240", "127.0.0.1"],
    }),
    explicitProxy: () => ({
      status: { state: "active", socksPort: 1080, httpPort: 3128, restartCount: 0 },
      allowedCidrs: ["192.168.3.0/24"],
    }),
    lanAddress: "192.168.3.240",
    listTable: async () => parseTableListing(SAMPLE_LISTING),
    listSet: async () => [{ address: "203.0.113.5", expiresSeconds: 100 }],
    ipForwardEnabled: () => true,
    routeInterface: async (_address, fwmark) => (fwmark === undefined ? "tun0" : "eth0"),
    fetchEgress: async () => ({ ok: true, ip: "198.51.100.7" }),
    queryRelay: async (name) => (name === "www.bypass.example" ? answer(["203.0.113.5"]) : answer(["192.0.2.80"])),
    tcpReachable: async () => true,
    ...overrides,
  };
}

function run(check: GatewayCheckId, deps: GatewayCheckDependencies, extra: Partial<GatewayCheckRequest> = {}) {
  return runGatewayCheck({ check, echoUrl: "https://api.ipify.org", ...extra }, deps);
}

describe("probeNameFor", () => {
  it("ワイルドカードは`www.`を付け、完全一致はそのまま", () => {
    expect(probeNameFor("*.example.com")).toBe("www.example.com");
    expect(probeNameFor("example.com")).toBe("example.com");
  });
});

describe("構成の照合（L1）", () => {
  it("gateway-rules・kill-switch-rules・dns-redirect-rulesは、適用中のルールが状態と一致すれば合格", async () => {
    const deps = createDeps();
    expect((await run("gateway-rules", deps)).status).toBe("pass");
    expect((await run("kill-switch-rules", deps)).status).toBe("pass");
    expect((await run("dns-redirect-rules", deps)).status).toBe("pass");
  });

  it("dns-relay-listening: 待受中なら待受アドレスを示して合格、待受に失敗していれば不合格", async () => {
    expect((await run("dns-relay-listening", createDeps())).observed).toBe("192.168.3.240:53・127.0.0.1:53 で待受中（UDP・TCP）");
    const failing = createDeps({
      relay: () => ({ ...createDeps().relay(), status: { state: "error", upstream: "unknown", bypassEntries: 0 } }),
    });
    const outcome = await run("dns-relay-listening", failing);
    expect(outcome.status).toBe("fail");
    expect(outcome.hint).toContain("DNS_RELAY_PORT");
  });

  it("explicit-proxy-listening: 稼働中で両ポートへ接続できれば合格、接続できないポートがあれば不合格", async () => {
    expect((await run("explicit-proxy-listening", createDeps())).status).toBe("pass");
    const closed = createDeps({ tcpReachable: async (_host, port) => port === 1080 });
    expect((await run("explicit-proxy-listening", closed)).observed).toBe("HTTP（3128）に接続できない");
  });
});

describe("ゲートウェイ内の通信（L2）", () => {
  it("tunnel-egress: トンネルへ束縛して取得した出口IPを、後続の項目用の値として返す", async () => {
    const fetchEgress = vi.fn(async () => ({ ok: true as const, ip: "198.51.100.7" }));
    const outcome = await run("tunnel-egress", createDeps({ fetchEgress }));
    expect(outcome).toMatchObject({ status: "pass", value: "198.51.100.7" });
    expect(fetchEgress).toHaveBeenCalledWith("https://api.ipify.org", { interface: "tun0" });
  });

  it("tunnel-egress: VPN未接続は未確認、取得失敗は不合格", async () => {
    const disconnected = createDeps({ gatewayState: () => ({ ...createDeps().gatewayState(), vpnIface: undefined }) });
    expect((await run("tunnel-egress", disconnected)).status).toBe("unconfirmed");
    const failing = createDeps({ fetchEgress: async () => ({ ok: false, error: "curl: (28) timed out" }) });
    expect((await run("tunnel-egress", failing)).status).toBe("fail");
  });

  it("dns-relay-resolve: IP確認サービスのホスト名を問い合わせ、応答と上流の状態で判定する", async () => {
    const queryRelay = vi.fn(async () => answer(["192.0.2.80"]));
    const outcome = await run("dns-relay-resolve", createDeps({ queryRelay }));
    expect(outcome.status).toBe("pass");
    expect(outcome.observed).toContain("vpngw-selfcheck");
    expect(queryRelay).toHaveBeenCalledWith("api.ipify.org", 53);

    expect((await run("dns-relay-resolve", createDeps({ queryRelay: async () => undefined }))).status).toBe("fail");
    expect((await run("dns-relay-resolve", createDeps({ queryRelay: async () => answer([], 2) }))).status).toBe("fail");
    const upstreamFailing = createDeps({
      relay: () => ({ ...createDeps().relay(), status: { state: "active", upstream: "failing", bypassEntries: 0 } }),
    });
    expect((await run("dns-relay-resolve", upstreamFailing)).observed).toContain("切り替え先の公開DNSで応答");
  });

  it("bypass-set: 迂回ドメインの名前解決結果がsetにあれば合格し、そのIPを返す。無ければ不合格", async () => {
    expect(await run("bypass-set", createDeps())).toMatchObject({ status: "pass", value: "203.0.113.5" });
    expect((await run("bypass-set", createDeps({ listSet: async () => [] }))).status).toBe("fail");
  });

  it("bypass-set: 名前解決結果（迂回できるIPv4）が得られなければ未確認", async () => {
    const blocked = createDeps({ queryRelay: async () => answer(["0.0.0.0"]) });
    expect((await run("bypass-set", blocked)).status).toBe("unconfirmed");
  });

  it("bypass-routing: 印付きは実回線、印なしはトンネルへ出れば合格。印付きがトンネルへ出れば不合格", async () => {
    expect((await run("bypass-routing", createDeps(), { bypassProbeIp: "203.0.113.5" })).status).toBe("pass");
    const broken = createDeps({ routeInterface: async () => "tun0" });
    const outcome = await run("bypass-routing", broken, { bypassProbeIp: "203.0.113.5" });
    expect(outcome.status).toBe("fail");
    expect(outcome.observed).toBe("印を付けた通信が tun0 へ出る");
    expect((await run("bypass-routing", createDeps())).status).toBe("unconfirmed");
  });

  it("bypass-isolation: 対照のドメインのIPが新たに登録されなければ合格、登録されれば不合格", async () => {
    expect((await run("bypass-isolation", createDeps())).status).toBe("pass");
    let calls = 0;
    const leaking = createDeps({
      listSet: async (): Promise<SetElement[]> => (calls++ === 0 ? [] : [{ address: "192.0.2.80", expiresSeconds: 100 }]),
    });
    expect((await run("bypass-isolation", leaking)).status).toBe("fail");
  });

  it("bypass-isolation: 対照のIPが既に登録済み（共有）なら未確認。迂回ドメインに含まれない対照を選ぶ", async () => {
    const shared = createDeps({ listSet: async () => [{ address: "192.0.2.80", expiresSeconds: 100 }] });
    expect((await run("bypass-isolation", shared)).status).toBe("unconfirmed");
    const queryRelay = vi.fn(async () => answer(["192.0.2.81"]));
    const relay = createDeps().relay();
    const deps = createDeps({ queryRelay, relay: () => ({ ...relay, settings: { ...relay.settings, excludedDomains: ["example.com"] } }) });
    await run("bypass-isolation", deps);
    expect(queryRelay).toHaveBeenCalledWith("example.net", 53);
  });

  it("explicit-proxy-egress: LAN側アドレスから両プロキシ経由で取得した出口IPが、トンネルの出口と一致すれば合格", async () => {
    const fetchEgress = vi.fn(async () => ({ ok: true as const, ip: "198.51.100.7" }));
    const outcome = await run("explicit-proxy-egress", createDeps({ fetchEgress }), { expectedEgressIp: "198.51.100.7" });
    expect(outcome.status).toBe("pass");
    expect(fetchEgress).toHaveBeenCalledWith("https://api.ipify.org", { proxy: "socks5h://192.168.3.240:1080" });
    expect(fetchEgress).toHaveBeenCalledWith("https://api.ipify.org", { proxy: "http://192.168.3.240:3128" });
    expect((await run("explicit-proxy-egress", createDeps(), { expectedEgressIp: "203.0.113.99" })).status).toBe("fail");
  });

  it("explicit-proxy-egress: ゲートウェイ自身が許可元に含まれない、トンネルの出口が無い場合は未確認", async () => {
    const narrow = createDeps({ explicitProxy: () => ({ ...createDeps().explicitProxy(), allowedCidrs: ["10.0.0.0/8"] }) });
    expect((await run("explicit-proxy-egress", narrow, { expectedEgressIp: "198.51.100.7" })).status).toBe("unconfirmed");
    expect((await run("explicit-proxy-egress", createDeps())).status).toBe("unconfirmed");
  });

  it("実行中の例外は、不合格ではなく未確認として返す", async () => {
    const throwing = createDeps({ listTable: async () => { throw new Error("boom"); } });
    const outcome = await run("gateway-rules", throwing);
    expect(outcome.status).toBe("unconfirmed");
    expect(outcome.reason).toContain("boom");
  });
});
