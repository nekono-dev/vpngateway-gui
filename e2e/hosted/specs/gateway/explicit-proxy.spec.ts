// 責務: 明示的プロキシの試験（gateway 群）。要件 7.1〜7.3。
// 許可された CIDR の端末だけがプロキシを使え、プロキシ経由の通信も VPN 接続中は VPN 出口から出ることを確かめる。
// 直列に実行する。

import { test, expect } from "@playwright/test";
import { apiClient } from "../../fixtures/stack";
import {
  ECHO_URL,
  GATEWAY_LAN_IP,
  VPN_EGRESS_IP,
  connectVpn,
  disconnectVpn,
  ensureAdminLogin,
  lanFetch,
  loginVpn,
  patchConfig,
} from "../../fixtures/gateway";

/** 目的: 明示的プロキシが稼働（active）になり、待ち受けポートを返すまで待つ（上限 60 秒）。 */
async function waitForProxyActive(client: ReturnType<typeof apiClient>): Promise<number> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await client.get<{ explicitProxy: { state: string; httpPort?: number } }>("/v1/connection/gateway");
    if (res.ok && res.body.explicitProxy.state === "active" && res.body.explicitProxy.httpPort !== undefined) {
      return res.body.explicitProxy.httpPort;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("明示的プロキシが稼働（active）にならなかった（上限 60 秒）");
}

test.describe.serial("明示的プロキシ（gateway）", () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });
  const client = apiClient();
  let proxyUrl = "";

  test.beforeAll(async () => {
    test.setTimeout(3 * 60 * 1000);
    await ensureAdminLogin(client);
    await loginVpn(client);
    await patchConfig(client, {
      transparentGatewayEnabled: false,
      dnsRelayEnabled: false,
      explicitProxyEnabled: true,
      explicitProxyAllowedCidrs: ["192.168.50.0/24"],
    });
    const port = await waitForProxyActive(client);
    proxyUrl = `http://${GATEWAY_LAN_IP}:${port}`;
  });

  test.afterAll(async () => {
    await disconnectVpn(client).catch(() => undefined);
  });

  test("7.1: 許可された CIDR の端末は、プロキシ経由で外部へ届く", async () => {
    await disconnectVpn(client);
    // LAN クライアント（192.168.50.10）は 192.168.50.0/24 に含まれる。未接続なので、送信元はゲートウェイの WAN 側
    const res = await lanFetch(ECHO_URL, ["-x", proxyUrl]);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    expect(res.ok && res.body).toBe(GATEWAY_LAN_IP);
  });

  test("7.2: 許可されていない CIDR の端末は、プロキシで拒否される", async () => {
    // 許可の範囲を、LAN クライアントを含まない CIDR に変える
    await patchConfig(client, { explicitProxyAllowedCidrs: ["192.168.60.0/24"] });
    await waitForProxyActive(client);
    try {
      const res = await lanFetch(ECHO_URL, ["-x", proxyUrl]);
      expect(res.ok, "許可されていない端末がプロキシを使えた").toBe(false);
    } finally {
      await patchConfig(client, { explicitProxyAllowedCidrs: ["192.168.50.0/24"] });
      await waitForProxyActive(client);
    }
  });

  test("7.3: VPN 接続中、プロキシ経由の通信の送信元は VPN 出口の IP になる", async () => {
    await connectVpn(client);
    const res = await lanFetch(ECHO_URL, ["-x", proxyUrl]);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    expect(res.ok && res.body).toBe(VPN_EGRESS_IP);
  });
});
