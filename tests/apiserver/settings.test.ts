// 責務: ユーザ向け設定の検証・永続化・ゲートウェイへの反映と、稼働状況の中継、設定の再通知の受け入れテスト。
// 受け入れ条件 apiserver/AC-14・AC-15・AC-29 を確認する。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeCli } from "../helpers/fake-cli.js";
import { startApiHarness, type ApiHarness } from "../helpers/api-harness.js";
import { startFakeGateway } from "../helpers/fake-gateway.js";
import { createTestPki } from "../helpers/pki.js";
import { repoPath } from "../helpers/repo.js";

const cli = createFakeCli();
// 稼働状況の応答を、テストから差し替える（未設定なら代役の既定の応答）。
let statusOverride: { status: number; json: unknown } | undefined;
let harness: ApiHarness;

beforeAll(async () => {
  harness = await startApiHarness({
    handlers: {
      exec: cli.exec,
      net: (method, path) => (method === "GET" && path === "/net/status" ? statusOverride : undefined),
    },
  });
});
afterAll(async () => {
  await harness.stop();
});

const get = (url: string) => harness.app.inject({ method: "GET", url });
const putConfig = (payload: object) => harness.app.inject({ method: "PUT", url: "/v1/connection/config", payload });
const settingsPosts = () => harness.gateway.requests.filter((request) => request.method === "POST" && request.path === "/net/settings");

describe("ユーザ向け設定", () => {
  it("apiserver/AC-14: 設定の更新は、形式不正を400で拒否し、受理した設定をゲートウェイへ通知する", async () => {
    const current = (await get("/v1/connection/config")).json() as Record<string, unknown>;
    // 形式不正は400で拒否し、保存もゲートウェイへの通知もしない。
    harness.gateway.requests.length = 0;
    const invalid: Array<Record<string, unknown>> = [
      { explicitProxyAllowedCidrs: ["300.1.1.1/24"] },
      { explicitProxyAllowedCidrs: ["192.168.3.0/24\nallow * 0.0.0.0/0"] },
      { excludedDomains: ["bad domain.example"] },
      { dnsRelayEnabled: true, dnsUpstreamUrl: "", dnsFallbackServers: [] },
      { dnsUpstreamUrl: "http://dns.home.example/dns-query" },
      { dnsFailureMode: "fallback", dnsFallbackServers: [] },
    ];
    for (const change of invalid) {
      const response = await putConfig({ ...current, ...change });
      expect(response.statusCode, JSON.stringify(change)).toBe(400);
    }
    expect(settingsPosts()).toHaveLength(0);
    expect((await get("/v1/connection/config")).json()).toEqual(current);

    // 受理した設定は、保存され、設定の全体がゲートウェイへ通知される。
    const next = {
      ...current,
      killSwitch: false,
      explicitProxyEnabled: true,
      explicitProxyAllowedCidrs: ["192.168.3.0/24"],
      excludedDomains: ["example.com", "*.example.org"],
      dnsRelayEnabled: true,
      dnsUpstreamUrl: "https://dns.home.example/dns-query",
    };
    const accepted = await putConfig(next);
    expect(accepted.statusCode).toBe(200);
    expect((await get("/v1/connection/config")).json()).toEqual(next);
    const posted = settingsPosts().at(-1)?.body;
    expect(posted).toMatchObject({
      killSwitch: false,
      explicitProxyEnabled: true,
      explicitProxyAllowedCidrs: ["192.168.3.0/24"],
      excludedDomains: ["example.com", "*.example.org"],
      dnsUpstreamUrl: "https://dns.home.example/dns-query",
    });
    // 動作検証で使うIP確認サービスのURLは、ゲートウェイへの反映に含めない。
    expect(posted).not.toHaveProperty("verifyEchoUrl");
  });

  it("apiserver/AC-15: 稼働状況はゲートウェイの応答を中継し、ゲートウェイに到達できないときは502になる", async () => {
    statusOverride = undefined;
    const relayed = await get("/v1/connection/gateway");
    expect(relayed.statusCode).toBe(200);
    expect(relayed.json()).toMatchObject({
      transparentGateway: { state: "active", vpnInterface: "tun0", killSwitchBlocking: false },
      explicitProxy: { state: "stopped", restartCount: 0 },
    });
    // 想定外の形状の応答は、そのまま返さずエラーにする。
    statusOverride = { status: 200, json: { unexpected: true } };
    expect((await get("/v1/connection/gateway")).statusCode).toBe(500);
    statusOverride = undefined;
    // ゲートウェイに到達できないときは502になる。
    await harness.gateway.close();
    expect((await get("/v1/connection/gateway")).statusCode).toBe(502);
  });
});

describe("設定の再通知", () => {
  let server: ChildProcess | undefined;
  let gateway: Awaited<ReturnType<typeof startFakeGateway>> | undefined;

  afterAll(async () => {
    server?.kill("SIGTERM");
    await gateway?.close();
  });

  it("apiserver/AC-29: 起動したAPIサーバは、既定で10秒後にもう一度、設定をゲートウェイへ通知する", async () => {
    const pki = createTestPki("gateway");
    const apiPki = createTestPki("api");
    gateway = await startFakeGateway(pki, { exec: cli.exec });
    const stateDir = mkdtempSync(join(tmpdir(), "vpngwgui-accept-server-"));
    // 設定の再通知の間隔は環境変数で変えられるため、既定値の検証では指定しない。
    const env = { ...process.env, SETTINGS_RESYNC_INTERVAL_MS: undefined };
    delete env.SETTINGS_RESYNC_INTERVAL_MS;
    server = spawn(repoPath("node_modules/.bin/tsx"), [repoPath("api/src/server.ts")], {
      env: {
        ...env,
        PORT: "0",
        VENDORS_DIR: repoPath("vendors"),
        ENABLED_PROVIDERS: "adguardvpn",
        STATE_DIR: stateDir,
        AUDIT_LOG_FILE: join(stateDir, "audit.log"),
        SETTINGS_FILE: join(stateDir, "settings.json"),
        GATEWAY_HOST: "127.0.0.1",
        GATEWAY_PORT: String(gateway.port),
        GATEWAY_TLS_CA_FILE: pki.caCert,
        GATEWAY_TLS_CERT_FILE: pki.clientCert,
        GATEWAY_TLS_KEY_FILE: pki.clientKey,
        API_TLS_CERT_FILE: apiPki.serverCert,
        API_TLS_KEY_FILE: apiPki.serverKey,
      },
      stdio: "ignore",
    });
    const posts = () => gateway?.requests.filter((request) => request.method === "POST" && request.path === "/net/settings").length ?? 0;
    // 起動直後に1回通知される。
    await waitUntil(() => posts() >= 1, 15000);
    const startedAt = Date.now();
    expect(posts()).toBe(1);
    // 10秒より前には再通知されず、10秒後に再通知される。
    await new Promise((resolve) => setTimeout(resolve, 8000));
    expect(posts()).toBe(1);
    await waitUntil(() => posts() >= 2, 6000);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(8000);
  }, 40000);
});

/** 目的: 条件が成り立つまで待つ。時間内に成り立たなければ例外。 */
async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition was not met in time");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
