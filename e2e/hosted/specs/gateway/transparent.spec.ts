// 責務: 透過ゲートウェイの試験（gateway 群）。要件 5.1〜5.4・13.4。
// LAN クライアント（名前空間 lan）の通信が、接続・未接続・Kill Switch の設定どおりに送出されることを確かめる。
// 直列に実行する（接続の状態を前の試験から引き継ぐ）。

import { test, expect } from "@playwright/test";
import { apiClient } from "../../fixtures/stack";
import {
  BYPASS_NAME,
  ECHO_URL,
  GATEWAY_LAN_IP,
  ISP_IP,
  VPN_EGRESS_IP,
  connectVpn,
  disconnectVpn,
  ensureAdminLogin,
  lanFetch,
  lanResolve,
  loginVpn,
  patchConfig,
  readCaPem,
} from "../../fixtures/gateway";

test.describe.serial("透過ゲートウェイ（gateway）", () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });
  const client = apiClient();

  test.beforeAll(async () => {
    await ensureAdminLogin(client);
    await loginVpn(client);
    // 透過ゲートウェイを有効にし、Kill Switch を有効にする（DNS 中継と明示的プロキシは、この群では使わない）
    await patchConfig(client, {
      transparentGatewayEnabled: true,
      killSwitch: true,
      explicitProxyEnabled: false,
      dnsRelayEnabled: false,
      excludedDomains: [],
    });
  });

  test.afterAll(async () => {
    await disconnectVpn(client).catch(() => undefined);
  });

  test("5.1: 接続中、LAN クライアントの通信の送信元は VPN 出口の IP になる", async () => {
    await connectVpn(client);
    const res = await lanFetch(ECHO_URL);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    expect(res.ok && res.body).toBe(VPN_EGRESS_IP);
  });

  test("5.2: 未接続で Kill Switch が有効なら、通信は遮断される", async () => {
    await disconnectVpn(client);
    await patchConfig(client, { killSwitch: true });
    const res = await lanFetch(ECHO_URL);
    expect(res.ok, "Kill Switch が有効なのに通信できた").toBe(false);
  });

  test("5.3: 未接続で Kill Switch が無効なら、通信は WAN へ直接送出される", async () => {
    await patchConfig(client, { killSwitch: false });
    const res = await lanFetch(ECHO_URL);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    // 送信元は、ゲートウェイの WAN 側（ホストの ISP 側のアドレス）になる
    expect(res.ok && res.body).toBe(GATEWAY_LAN_IP);
  });

  test("5.4: 迂回対象のドメインは、接続中でも VPN を経由せず直接送出される", async () => {
    // 迂回には名前解決（DNS 中継）が要る。中継を有効にして、迂回対象を登録する
    await patchConfig(client, {
      dnsRelayEnabled: true,
      dnsUpstreamUrl: `https://${ISP_IP}/dns-query`,
      dnsUpstreamCaPem: await readCaPem(),
      excludedDomains: [BYPASS_NAME],
      killSwitch: true,
    });
    await connectVpn(client);
    // 迂回対象の名前を引くと、その IP は迂回の対象として保持される
    expect(await lanResolve(BYPASS_NAME)).toBe(ISP_IP);
    const res = await lanFetch(ECHO_URL);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    // 迂回されていれば、VPN 出口（192.168.50.200）ではなくゲートウェイの WAN 側から出る
    expect(res.ok && res.body).toBe(GATEWAY_LAN_IP);
  });

  test("13.4: 保存した Kill Switch の設定が、再起動なしで通信に反映される", async () => {
    await disconnectVpn(client);
    await patchConfig(client, { excludedDomains: [], dnsRelayEnabled: false, killSwitch: true });
    expect((await lanFetch(ECHO_URL)).ok, "保存した Kill Switch（有効）が反映されていない").toBe(false);

    await patchConfig(client, { killSwitch: false });
    const saved = await client.get<{ killSwitch: boolean }>("/v1/connection/config");
    expect(saved.ok && saved.body.killSwitch).toBe(false);
    const res = await lanFetch(ECHO_URL);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
  });
});
