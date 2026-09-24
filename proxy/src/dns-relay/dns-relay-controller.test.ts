// 責務: DNS中継の調停（dns-relay-controller.ts）の単体テスト。待受と中継処理は差し替える。

import { describe, expect, it, vi } from "vitest";
import { DnsRelayController, sanitizeExcludedDomains, type DnsRelaySettings } from "./dns-relay-controller.js";
import type { DnsRelay } from "./relay.js";

const ENABLED: DnsRelaySettings = {
  enabled: true,
  excludedDomains: ["example.com"],
  upstreamUrl: "https://dns.home.example/dns-query",
  upstreamCaPem: "",
  failureMode: "failClosed",
  fallbackServers: [],
  clientNameServers: [],
};

function setup(startImpl: () => Promise<void> = async () => undefined) {
  const listener = { start: vi.fn(startImpl), stop: vi.fn(async () => undefined) };
  const relay = { updateConfig: vi.fn(), getUpstreamState: vi.fn(() => "ok" as const), handle: vi.fn() };
  const events: Record<string, unknown>[] = [];
  const controller = new DnsRelayController({
    port: 5353,
    listenAddresses: ["192.168.3.240", "127.0.0.1"],
    registerBypass: () => undefined,
    bypassEntryCount: () => 3,
    onEvent: (event) => events.push(event),
    listener,
    relay: relay as unknown as DnsRelay,
  });
  return { controller, listener, relay, events };
}

describe("DnsRelayController", () => {
  it("無効なら待受せずstopped", async () => {
    const { controller, listener } = setup();
    await controller.applySettings({ ...ENABLED, enabled: false });
    expect(listener.start).not.toHaveBeenCalled();
    expect(controller.getStatus()).toEqual({ state: "stopped", upstream: "unknown", bypassEntries: 3 });
  });

  it("有効: 指定アドレス・ポートで待受を開始しactiveになる", async () => {
    const { controller, listener, relay, events } = setup();
    await controller.applySettings(ENABLED);
    expect(listener.start).toHaveBeenCalledWith(["192.168.3.240", "127.0.0.1"], 5353, expect.any(Function));
    expect(relay.updateConfig).toHaveBeenCalled();
    expect(controller.getStatus().state).toBe("active");
    expect(controller.getStatus().upstream).toBe("ok");
    expect(events.map((event) => event.event)).toEqual(["dns_relay_started"]);
  });

  it("上流もフォールバック先も空ならunconfigured（待受しない）", async () => {
    const { controller, listener } = setup();
    await controller.applySettings({ ...ENABLED, upstreamUrl: "" });
    expect(listener.start).not.toHaveBeenCalled();
    expect(controller.getStatus().state).toBe("unconfigured");
  });

  it("同じ設定の再通知では何もしない。設定が変わっても待受は再起動せず、中継の設定だけ更新する", async () => {
    const { controller, listener, relay } = setup();
    await controller.applySettings(ENABLED);
    await controller.applySettings({ ...ENABLED });
    expect(relay.updateConfig).toHaveBeenCalledTimes(1);
    await controller.applySettings({ ...ENABLED, excludedDomains: ["example.org"] });
    expect(relay.updateConfig).toHaveBeenCalledTimes(2);
    expect(listener.start).toHaveBeenCalledTimes(1);
  });

  it("有効→無効: 待受を止める", async () => {
    const { controller, listener, events } = setup();
    await controller.applySettings(ENABLED);
    await controller.applySettings({ ...ENABLED, enabled: false });
    expect(listener.stop).toHaveBeenCalledTimes(1);
    expect(controller.getStatus().state).toBe("stopped");
    expect(events.map((event) => event.event)).toEqual(["dns_relay_started", "dns_relay_stopped"]);
  });

  it("待受に失敗したらerrorとし、同じ設定の再通知で再試行して回復する", async () => {
    let fail = true;
    const { controller, listener, events } = setup(async () => {
      if (fail) throw new Error("EADDRINUSE");
    });
    await controller.applySettings(ENABLED);
    expect(controller.getStatus().state).toBe("error");
    expect(events[0]).toMatchObject({ event: "dns_relay_config_error", message: "EADDRINUSE" });
    fail = false;
    await controller.applySettings(ENABLED);
    expect(listener.start).toHaveBeenCalledTimes(2);
    expect(controller.getStatus().state).toBe("active");
  });

  it("不正な表記の迂回ドメインは、中継へ渡す前に取り除く", async () => {
    const { controller, relay } = setup();
    await controller.applySettings({ ...ENABLED, excludedDomains: ["example.com", "bad domain", "*.example.org"] });
    expect(relay.updateConfig.mock.calls[0][0].excludedDomains).toEqual(["example.com", "*.example.org"]);
  });
});

describe("sanitizeExcludedDomains", () => {
  it("妥当な表記だけを残す", () => {
    expect(sanitizeExcludedDomains(["a.example", "bad domain", "*.b.example"])).toEqual(["a.example", "*.b.example"]);
  });
});
