// 責務: 動作検証と出口 IP の観測の試験（gateway 群）。要件 8.1〜8.6。
// 検証の開始・状態の取得・実行中の 409・対象外の項目・ブラウザの出口 IP の提出（最初の 1 回のみ採用）・全項目の合格を確かめる。
// 直列に実行する。

import { test, expect } from "@playwright/test";
import { apiClient } from "../../fixtures/stack";
import {
  BYPASS_NAME,
  ECHO_URL,
  ISP_IP,
  VPN_EGRESS_IP,
  connectVpn,
  disconnectVpn,
  ensureAdminLogin,
  loginVpn,
  patchConfig,
  readCaPem,
} from "../../fixtures/gateway";

type Check = { id: string; status: string };
type Verification = { id: string; state: "running" | "completed"; checks: Check[] };

/** 目的: 検証が完了するまで取得を繰り返す（上限 3 分）。 */
async function waitForVerification(client: ReturnType<typeof apiClient>, id: string): Promise<Verification> {
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await client.get<Verification>(`/v1/verifications/${id}`);
    expect(res.ok, "検証の状態が取得できない").toBe(true);
    if (res.ok && res.body.state === "completed") return res.body;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`検証が完了しなかった（上限 3 分）: ${id}`);
}

/** 目的: 検証を開始し、受け付けた識別子を返す。 */
async function startVerification(client: ReturnType<typeof apiClient>): Promise<string> {
  const res = await client.post<Verification>("/v1/verifications");
  expect(res.ok && res.status, "検証の開始が 202 でない").toBe(202);
  return res.ok ? res.body.id : "";
}

/** 目的: 項目の ID に対応する状態を返す（項目が無ければ undefined）。 */
function statusOfCheck(verification: Verification, id: string): string | undefined {
  return verification.checks.find((check) => check.id === id)?.status;
}

test.describe.serial("動作検証と出口 IP の観測（gateway）", () => {
  test.describe.configure({ timeout: 10 * 60 * 1000 });
  const client = apiClient();

  test.beforeAll(async () => {
    test.setTimeout(5 * 60 * 1000);
    await ensureAdminLogin(client);
    await loginVpn(client);
    // 全ての機能を有効にする（DNS の 53 番リダイレクトは、クライアント側の通過の確認が要るため、この試験では無効）
    await patchConfig(client, {
      verifyEchoUrl: ECHO_URL,
      transparentGatewayEnabled: true,
      killSwitch: true,
      dnsRelayEnabled: true,
      dnsUpstreamUrl: `https://${ISP_IP}/dns-query`,
      dnsUpstreamCaPem: await readCaPem(),
      dnsRedirectEnabled: false,
      excludedDomains: [BYPASS_NAME],
      explicitProxyEnabled: true,
      explicitProxyAllowedCidrs: ["192.168.50.0/24"],
    });
    await connectVpn(client);
  });

  test.afterAll(async () => {
    await disconnectVpn(client).catch(() => undefined);
  });

  test("8.1・8.2: 検証を開始すると 202 と識別子を返し、完了後に項目ごとの結果を返す", async () => {
    const id = await startVerification(client);
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    const verification = await waitForVerification(client, id);
    expect(verification.checks.length).toBeGreaterThan(0);
    // 有効な機能の項目は、合格か未確認（ブラウザの観測が要る項目）のいずれかになる
    for (const check of verification.checks) {
      expect(["pass", "unconfirmed", "notApplicable"], `項目 ${check.id}`).toContain(check.status);
    }
  });

  test("8.3: 実行中に別の検証を開始すると 409 を返す", async () => {
    const first = await startVerification(client);
    const second = await client.post("/v1/verifications");
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.kind === "http" ? second.status : 0).toBe(409);
    await waitForVerification(client, first);
  });

  test("8.4: 無効な機能の項目は、対象外（notApplicable）として返す", async () => {
    await patchConfig(client, { explicitProxyEnabled: false });
    try {
      const id = await startVerification(client);
      const verification = await waitForVerification(client, id);
      expect(statusOfCheck(verification, "explicit-proxy-listening")).toBe("notApplicable");
      expect(statusOfCheck(verification, "explicit-proxy-egress")).toBe("notApplicable");
    } finally {
      await patchConfig(client, { explicitProxyEnabled: true });
    }
  });

  test("8.5: ブラウザが観測した出口 IP は、最初の提出だけが採用される", async () => {
    const id = await startVerification(client);
    const first = await client.put<{ accepted: boolean }>(`/v1/verifications/${id}/client-observations/egress-ip`, { ip: VPN_EGRESS_IP });
    expect(first.ok && first.body.accepted).toBe(true);
    const second = await client.put<{ accepted: boolean }>(`/v1/verifications/${id}/client-observations/egress-ip`, { ip: "198.51.100.7" });
    expect(second.ok && second.body.accepted).toBe(false);
    await waitForVerification(client, id);
  });

  test("8.6: 有効な機能に該当するすべての項目が合格する", async () => {
    // 出口 IP を提出して、この端末からの確認も合格させる
    const id = await startVerification(client);
    await client.put(`/v1/verifications/${id}/client-observations/egress-ip`, { ip: VPN_EGRESS_IP });
    const verification = await waitForVerification(client, id);
    const failed = verification.checks.filter((check) => check.status !== "pass" && check.status !== "notApplicable");
    expect(failed.map((check) => `${check.id}=${check.status}`)).toEqual([]);
  });
});
