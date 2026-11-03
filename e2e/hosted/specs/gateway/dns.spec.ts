// 責務: DNS 中継・53 番リダイレクトの試験（gateway 群）。要件 6.1〜6.4。
// 上流（DoH）の停止は、ISP の模擬サービスの DoH を一時停止して起こす（SIGUSR1・SIGUSR2）。
// 直列に実行する。

import { test, expect } from "@playwright/test";
import { apiClient } from "../../fixtures/stack";
import {
  ISP_IP,
  REDIRECT_NAME,
  RELAY_NAME,
  ensureAdminLogin,
  ispSignal,
  lanDnsQuery,
  lanResolve,
  patchConfig,
  readCaPem,
} from "../../fixtures/gateway";

/** 直接の応答（plain DNS の directAnswers・isp-dns.ts・zone の records.json）。 */
const DIRECT_ANSWER = "203.0.113.99";

/** 目的: DNS 中継の待受が有効（active）になるまで待つ（上限 60 秒）。 */
async function waitForRelayActive(client: ReturnType<typeof apiClient>): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await client.get<{ dnsRelay?: { state: string } }>("/v1/connection/gateway");
    if (res.ok && res.body.dnsRelay?.state === "active") return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("DNS 中継が有効（active）にならなかった（上限 60 秒）");
}

test.describe.serial("DNS 中継・53 番リダイレクト（gateway）", () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });
  const client = apiClient();

  test.beforeAll(async () => {
    test.setTimeout(3 * 60 * 1000);
    await ensureAdminLogin(client);
    // 中継を有効にする（上流は ISP の DoH。CA は作業場所のテスト CA）。透過ゲートウェイは、この群では使わない
    await patchConfig(client, {
      // 設定の規則により、透過ゲートウェイか明示的プロキシの一方は有効でなければならない（この群は透過ゲートウェイを使う）
      transparentGatewayEnabled: true,
      explicitProxyEnabled: false,
      dnsRelayEnabled: true,
      dnsUpstreamUrl: `https://${ISP_IP}/dns-query`,
      dnsUpstreamCaPem: await readCaPem(),
      dnsRedirectEnabled: false,
      dnsFailureMode: "failClosed",
      dnsFallbackServers: [],
      excludedDomains: [],
    });
    await waitForRelayActive(client);
  });

  test.afterAll(async () => {
    // 上流の停止を戻す（失敗した試験で残らないように）
    await ispSignal("USR2").catch(() => undefined);
  });

  test("6.1: DNS 中継が有効なとき、LAN クライアントの名前解決は上流の応答を返す", async () => {
    expect(await lanResolve(RELAY_NAME)).toBe(ISP_IP);
  });

  test("6.2: 53 番リダイレクトが有効なら、他の DNS サーバへの問い合わせは中継へ転送される", async () => {
    // 無効なときは、問い合わせた DNS サーバ（ISP）の直接の応答が返る（中継を通らない対照）
    await patchConfig(client, { dnsRedirectEnabled: false });
    expect(await lanDnsQuery(ISP_IP, REDIRECT_NAME)).toBe(DIRECT_ANSWER);

    // 有効なときは、中継（上流の DoH）の応答になる。中継の対応表には無い名前なので NXDOMAIN
    await patchConfig(client, { dnsRedirectEnabled: true });
    expect(await lanDnsQuery(ISP_IP, REDIRECT_NAME)).toBe("NXDOMAIN");
    await patchConfig(client, { dnsRedirectEnabled: false });
  });

  test("6.3: 上流に届かないとき、failClosed は失敗を返し、フォールバックを使わない", async () => {
    await patchConfig(client, { dnsFailureMode: "failClosed", dnsFallbackServers: [] });
    await ispSignal("USR1");
    try {
      // 上流（DoH）が応答しないため、名前解決は失敗する（フォールバック先は無い）
      expect(await lanResolve(RELAY_NAME)).toBeNull();
    } finally {
      await ispSignal("USR2");
    }
    expect(await lanResolve(RELAY_NAME)).toBe(ISP_IP);
  });

  test("6.4: 上流に届かないとき、fallback はフォールバック先で解決する", async () => {
    // フォールバック先は ISP の平文 DNS（上流の DoH とは別の経路）
    await patchConfig(client, { dnsFailureMode: "fallback", dnsFallbackServers: [ISP_IP] });
    await ispSignal("USR1");
    try {
      expect(await lanResolve(RELAY_NAME)).toBe(ISP_IP);
    } finally {
      await ispSignal("USR2");
    }
    await patchConfig(client, { dnsFailureMode: "failClosed", dnsFallbackServers: [] });
  });
});
