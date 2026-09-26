// 責務: 設定の動作検証の実行と保持（verification-service.ts）の単体テスト。ゲートウェイとの通信・時刻・待機は差し替える。

import { describe, expect, it, vi } from "vitest";
import type { UserSettings } from "../schemas/settings.js";
import type { GatewayCheckInput, GatewayCheckResult } from "../proxy-client/proxy-client.js";
import { VerificationRunningError } from "../errors.js";
import { VerificationService, type VerificationDependencies } from "./verification-service.js";

const SETTINGS: UserSettings = {
  killSwitch: true,
  excludedDomains: ["*.bypass.example"],
  transparentGatewayEnabled: true,
  explicitProxyEnabled: false,
  explicitProxyAllowedCidrs: [],
  dnsRelayEnabled: true,
  dnsUpstreamUrl: "https://dns.home.example/dns-query",
  dnsUpstreamCaPem: "",
  dnsFailureMode: "failClosed",
  dnsFallbackServers: [],
  dnsClientNameServers: [],
  dnsRedirectEnabled: true,
  dnsRedirectExcludedCidrs: [],
  verifyEchoUrl: "https://api.ipify.org",
};

function gatewayResult(check: string): GatewayCheckResult {
  if (check === "tunnel-egress") return { id: check, status: "pass", observed: "198.51.100.7（tun0 経由）", value: "198.51.100.7" };
  if (check === "bypass-set") return { id: check, status: "pass", observed: "登録", value: "203.0.113.5" };
  return { id: check, status: "pass", observed: `${check} ok` };
}

function createService(overrides: Partial<VerificationDependencies> = {}) {
  const calls: GatewayCheckInput[] = [];
  const audit: unknown[] = [];
  const deps: VerificationDependencies = {
    runGatewayCheck: async (input) => {
      calls.push(input);
      return gatewayResult(input.check);
    },
    registerCheckNonce: async () => undefined,
    fetchCheckNonce: async () => ({ received: true, redirected: true, recentRedirectedClients: 1 }),
    appendAuditLog: (entry) => audit.push(entry),
    now: () => 0,
    sleep: async () => undefined,
    ...overrides,
  };
  return { service: new VerificationService(deps), calls, audit };
}

describe("VerificationService", () => {
  it("設定から対象・対象外を決め、対象の項目を実行順に1つずつ実行する", async () => {
    const { service, calls, audit } = createService();
    const started = await service.start(SETTINGS);
    expect(started.state).toBe("running");
    expect(started.checks.map((check) => check.id)).toEqual([
      "gateway-rules", "kill-switch-rules", "dns-relay-listening", "dns-redirect-rules", "explicit-proxy-listening",
      "tunnel-egress", "dns-relay-resolve", "bypass-set", "bypass-routing", "bypass-isolation", "explicit-proxy-egress",
      "client-egress", "dns-redirect-path",
    ]);
    expect(started.checks.find((check) => check.id === "explicit-proxy-listening")).toMatchObject({
      status: "notApplicable",
      reason: "明示的プロキシが無効のため",
    });
    expect(started.clientProbe?.dnsName).toMatch(/^vpngw-[0-9a-f]{16}\.example\.com$/);

    service.submitEgressIp(started.id, "198.51.100.7");
    await service.whenDone(started.id);
    const done = service.get(started.id);
    expect(done?.state).toBe("completed");
    expect(done?.checks.filter((check) => check.status === "pass")).toHaveLength(11);
    expect(calls.map((call) => call.check)).toEqual([
      "gateway-rules", "kill-switch-rules", "dns-relay-listening", "dns-redirect-rules",
      "tunnel-egress", "dns-relay-resolve", "bypass-set", "bypass-routing", "bypass-isolation",
    ]);
    expect(audit).toEqual([{ action: "verification_run", input: { checks: 11, pass: 11, fail: 0, unconfirmed: 0 } }]);
  });

  it("前の項目の結果（トンネルの出口IP・迂回対象のIP）を後続の項目へ渡す。IP確認サービスは設定のURL", async () => {
    const { service, calls } = createService();
    const started = await service.start({ ...SETTINGS, explicitProxyEnabled: true, verifyEchoUrl: "https://ipinfo.io/ip" });
    await service.whenDone(started.id);
    expect(calls.find((call) => call.check === "bypass-routing")).toMatchObject({
      bypassProbeIp: "203.0.113.5",
      echoUrl: "https://ipinfo.io/ip",
    });
    expect(calls.find((call) => call.check === "explicit-proxy-egress")?.expectedEgressIp).toBe("198.51.100.7");
    expect(calls.find((call) => call.check === "gateway-rules")?.expectedEgressIp).toBeUndefined();
  });

  it("実行中は項目を「実行中」として公開し、不合格・未確認があっても後続を続行する", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = createService({
      runGatewayCheck: async (input) => {
        if (input.check === "kill-switch-rules") await gate;
        if (input.check === "gateway-rules") return { id: input.check, status: "fail", expected: "e", observed: "o", hint: "h" };
        return gatewayResult(input.check);
      },
    });
    const started = await service.start(SETTINGS);
    await vi.waitFor(() => expect(service.get(started.id)?.checks[1].status).toBe("running"));
    const running = service.get(started.id);
    expect(running?.checks[0]).toMatchObject({ status: "fail", expected: "e", observed: "o", hint: "h" });
    expect(running?.checks[2].status).toBe("pending");
    release();
    await service.whenDone(started.id);
    expect(service.get(started.id)?.checks[2].status).toBe("pass");
  });

  it("各項目は最短400ms「実行中」を保つ（結果の公開だけを遅らせる）", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    let now = 0;
    const { service } = createService({
      sleep,
      now: () => now,
      runGatewayCheck: async (input) => {
        now += input.check === "gateway-rules" ? 1000 : 100;
        return gatewayResult(input.check);
      },
    });
    const started = await service.start({ ...SETTINGS, dnsRelayEnabled: false, killSwitch: false });
    service.submitEgressIp(started.id, "198.51.100.7");
    await service.whenDone(started.id);
    // gateway-rules(1000ms)は待たず、tunnel-egress(100ms)は300ms、client-egress(0ms)は400ms待つ。
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([300, 400]);
  });

  it("同時に1件まで。実行中に開始するとVerificationRunningError、完了後は開始できる", async () => {
    const { service } = createService();
    const started = await service.start(SETTINGS);
    await expect(service.start(SETTINGS)).rejects.toBeInstanceOf(VerificationRunningError);
    await service.whenDone(started.id);
    await expect(service.start(SETTINGS)).resolves.toMatchObject({ state: "running" });
  });

  it("ゲートウェイに接続できない項目は、不合格ではなく未確認", async () => {
    const { service } = createService({ runGatewayCheck: async () => { throw new Error("ECONNREFUSED"); } });
    const started = await service.start(SETTINGS);
    await service.whenDone(started.id);
    expect(service.get(started.id)?.checks[0]).toMatchObject({ status: "unconfirmed", reason: "ゲートウェイに接続できないため、確認できません。" });
  });

  it("出口IPの提出は最初の1回のみ採用し、未知のIDはundefined。提出が無ければ待ち時間の後に未確認", async () => {
    const { service } = createService();
    const started = await service.start(SETTINGS);
    expect(service.submitEgressIp(started.id, null)).toBe(true);
    expect(service.submitEgressIp(started.id, "198.51.100.7")).toBe(false);
    expect(service.submitEgressIp("00000000-0000-0000-0000-000000000000", null)).toBeUndefined();
    await service.whenDone(started.id);
    expect(service.get(started.id)?.checks.find((check) => check.id === "client-egress")?.status).toBe("unconfirmed");

    const second = createService();
    const other = await second.service.start(SETTINGS);
    await second.service.whenDone(other.id);
    expect(second.service.get(other.id)?.checks.find((check) => check.id === "client-egress")?.reason).toContain("結果が届きませんでした");
  });

  it("検証名の受信を待ち（最大10秒）、記録から判定する。登録に失敗していれば未確認", async () => {
    const fetchCheckNonce = vi
      .fn()
      .mockResolvedValueOnce({ received: false, redirected: false, recentRedirectedClients: 0 })
      .mockResolvedValue({ received: true, redirected: true, recentRedirectedClients: 1 });
    const { service } = createService({ fetchCheckNonce });
    const started = await service.start(SETTINGS);
    await service.whenDone(started.id);
    expect(fetchCheckNonce).toHaveBeenCalledTimes(2);
    expect(service.get(started.id)?.checks.at(-1)?.status).toBe("pass");

    const never = vi.fn(async () => ({ received: false, redirected: false, recentRedirectedClients: 0 }));
    const waiting = createService({ fetchCheckNonce: never });
    const second = await waiting.service.start(SETTINGS);
    await waiting.service.whenDone(second.id);
    expect(never).toHaveBeenCalledTimes(21);
    expect(waiting.service.get(second.id)?.checks.at(-1)?.status).toBe("unconfirmed");

    const unregistered = createService({ registerCheckNonce: async () => { throw new Error("down"); } });
    const third = await unregistered.service.start(SETTINGS);
    expect(third.clientProbe).toBeUndefined();
    await unregistered.service.whenDone(third.id);
    expect(unregistered.service.get(third.id)?.checks.at(-1)?.status).toBe("unconfirmed");
  });

  it("結果は直近5件のみ保持する", async () => {
    const { service } = createService();
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const started = await service.start(SETTINGS);
      ids.push(started.id);
      await service.whenDone(started.id);
    }
    expect(service.get(ids[0])).toBeUndefined();
    expect(service.get(ids[5])?.state).toBe("completed");
  });
});
