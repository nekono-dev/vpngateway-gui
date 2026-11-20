// 責務: APIの実クライアントから本番GatewayルートへUDS経由で設定を反映する結合テスト。

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayController } from "../proxy/src/network/gateway-controller.js";
import { GatewayGuard } from "../proxy/src/network/gateway-guard.js";
import type { DnsRelayState } from "../proxy/src/dns-relay/dns-relay-controller.js";
import type { ExplicitProxyState } from "../proxy/src/explicit-proxy/explicit-proxy-controller.js";
import { createGatewayChannelServer } from "../proxy/src/gateway-channel/control-server.js";
import { listenOnGatewaySocket } from "../proxy/src/gateway-channel/server.js";
import { createGatewayRequestHandler } from "../proxy/src/gateway-channel/gateway-routes.js";

const directories: string[] = [];
const listeners: Array<Awaited<ReturnType<typeof listenOnGatewaySocket>>> = [];
const guards: GatewayGuard[] = [];

afterEach(async () => {
  for (const listener of listeners.splice(0)) await listener.close();
  for (const guard of guards.splice(0)) guard.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  for (const name of ["GATEWAY_SOCKET_PATH", "GATEWAY_TLS_ENABLED", "GATEWAY_TLS_CA_FILE", "GATEWAY_TLS_CERT_FILE", "GATEWAY_TLS_KEY_FILE", "GATEWAY_TLS_CLIENT_CERT_FILE", "GATEWAY_TLS_CLIENT_KEY_FILE", "GATEWAY_TLS_SERVER_NAME"]) delete process.env[name];
  vi.resetModules();
});

function callApiClient<T>(operation: () => Promise<T>): Promise<T> {
  return operation();
}

function createDnsRelayControllerFake(): Pick<import("../proxy/src/dns-relay/dns-relay-controller.js").DnsRelayController, "applySettings" | "getStatus"> & { stop: () => Promise<void> } {
  return {
    applySettings: async () => undefined,
    getStatus: () => ({ state: "active" as DnsRelayState, upstream: "unknown" as const, bypassEntries: 0 }),
    stop: async () => undefined,
  };
}

function createExplicitProxyControllerFake(): Pick<import("../proxy/src/explicit-proxy/explicit-proxy-controller.js").ExplicitProxyController, "applySettings" | "getStatus"> {
  return {
    applySettings: () => undefined,
    getStatus: () => ({ state: "stopped" as ExplicitProxyState, restartCount: 0 }),
  };
}

interface TestCertificates {
  caPath: string;
  serverCertPath: string;
  serverKeyPath: string;
  clientCertPath: string;
  clientKeyPath: string;
}

function issueTestCertificate(directory: string, caKeyPath: string, caCertPath: string, name: string, usage: "serverAuth" | "clientAuth"): { certPath: string; keyPath: string } {
  const keyPath = join(directory, `${name}.key`);
  const csrPath = join(directory, `${name}.csr`);
  const certPath = join(directory, `${name}.crt`);
  const extensionPath = join(directory, `${name}.ext`);
  execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", csrPath, "-subj", `/CN=${name}`]);
  writeFileSync(extensionPath, `subjectAltName=DNS:localhost\nextendedKeyUsage=${usage}\nkeyUsage=digitalSignature,keyEncipherment\n`);
  execFileSync("openssl", ["x509", "-req", "-in", csrPath, "-CA", caCertPath, "-CAkey", caKeyPath, "-CAcreateserial", "-days", "1", "-out", certPath, "-extfile", extensionPath]);
  return { certPath, keyPath };
}

function createTestCertificates(directory: string): TestCertificates {
  const caKeyPath = join(directory, "test-ca.key");
  const caPath = join(directory, "test-ca.crt");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", caKeyPath, "-out", caPath, "-subj", "/CN=gateway-test-ca"]);
  const server = issueTestCertificate(directory, caKeyPath, caPath, "gateway-server", "serverAuth");
  const client = issueTestCertificate(directory, caKeyPath, caPath, "api-client", "clientAuth");
  return { caPath, serverCertPath: server.certPath, serverKeyPath: server.keyPath, clientCertPath: client.certPath, clientKeyPath: client.keyPath };
}

function requestSettings(socketPath: string, tlsEnabled: boolean, certificates?: TestCertificates): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = (tlsEnabled ? httpsRequest : httpRequest)({
      socketPath,
      path: "/net/settings",
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(tlsEnabled ? {
        ca: readFileSync(certificates?.caPath ?? ""),
        cert: readFileSync(certificates?.clientCertPath ?? ""),
        key: readFileSync(certificates?.clientKeyPath ?? ""),
        servername: "localhost",
      } : {}),
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body }));
    });
    request.once("error", reject);
    request.end(JSON.stringify({
      killSwitch: true,
      transparentGatewayEnabled: false,
      explicitProxyEnabled: false,
      explicitProxyAllowedCidrs: [],
    }));
  });
}

describe.each([false, true])("本番Gateway制御handler over UDS (TLS=%s)", (tlsEnabled) => {
  it("実API clientで設定を適用し、statusとguard失敗を確認する", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gateway-control-integration-"));
    directories.push(directory);
    const socketPath = join(directory, "gateway.sock");
    const certificates = tlsEnabled ? createTestCertificates(directory) : undefined;
    process.env.GATEWAY_SOCKET_PATH = socketPath;
    process.env.GATEWAY_TLS_ENABLED = String(tlsEnabled);
    if (tlsEnabled) {
      if (!certificates) throw new Error("TLS test certificates are required");
      process.env.GATEWAY_TLS_CA_FILE = certificates.caPath;
      process.env.GATEWAY_TLS_CERT_FILE = certificates.serverCertPath;
      process.env.GATEWAY_TLS_KEY_FILE = certificates.serverKeyPath;
      process.env.GATEWAY_TLS_CLIENT_CERT_FILE = certificates.clientCertPath;
      process.env.GATEWAY_TLS_CLIENT_KEY_FILE = certificates.clientKeyPath;
      process.env.GATEWAY_TLS_SERVER_NAME = "localhost";
    }

    let rejectGuardApply = false;
    const runNft = async (script: string) => ({
      exitCode: rejectGuardApply && script.includes("vpngwgui_guard") ? 1 : 0,
      stdout: "",
      stderr: "rejected",
    });
    const guard = new GatewayGuard("eth0", runNft, { listenerAvailable: false, intervalMs: 60_000 });
    guards.push(guard);
    const gateway = new GatewayController("eth0", "eth0", runNft);
    const dnsRelay = createDnsRelayControllerFake();
    const explicitProxy = createExplicitProxyControllerFake();
    const handler = createGatewayRequestHandler({
      gatewayController: gateway,
      gatewayGuard: guard,
      dnsRelayController: dnsRelay,
      explicitProxyController: explicitProxy,
      settingsRequestQueue: { run: (operation) => operation() },
      lanAddress: "192.0.2.1",
      dnsRelayPort: 53,
      lanCidr: "192.0.2.0/24",
      logAuditEvent: () => undefined,
    });
    const server = createGatewayChannelServer(handler, process.env);
    listeners.push(await listenOnGatewaySocket(server, socketPath, process.getuid?.() ?? 0));
    guard.setListenerAvailable(true);

    vi.resetModules();
    const { notifySettings, fetchProxyStatus } = await import("../api/src/proxy-client/proxy-client.js");
    const applied = await callApiClient(() => notifySettings({
      killSwitch: true,
      transparentGatewayEnabled: true,
      explicitProxyEnabled: false,
      explicitProxyAllowedCidrs: [],
    }));
    expect(applied).toEqual({ succeeded: true, applied: true });
    await expect(fetchProxyStatus()).resolves.toMatchObject({
      gatewayGuard: { state: "LEASE", healthy: true },
    });

    rejectGuardApply = true;
    await expect(notifySettings({
      killSwitch: true,
      transparentGatewayEnabled: false,
      explicitProxyEnabled: false,
      explicitProxyAllowedCidrs: [],
    })).rejects.toThrow(/unexpected status from proxy: 503/);
    await expect(requestSettings(socketPath, tlsEnabled, certificates)).resolves.toEqual({
      statusCode: 503,
      body: JSON.stringify({ error: "guard_apply_failed" }),
    });
    const status = await fetchProxyStatus();
    expect(status.gatewayGuard).toMatchObject({ state: "LEASE", healthy: false });
  });
});

describe("管理者のGateway再起動要求 over UDS", () => {
  it("依頼ファイルの内容・権限・所有者を確認し、既存依頼と利用不可をAPI応答へ返す", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gateway-reboot-integration-"));
    directories.push(directory);
    const hostCtlDir = join(directory, "host-ctl");
    const stateDir = join(directory, "state");
    const socketPath = join(directory, "gateway.sock");
    const auditLog = join(directory, "audit.log");
    process.env.HOST_CTL_DIR = hostCtlDir;
    process.env.GATEWAY_SOCKET_PATH = socketPath;
    process.env.GATEWAY_TLS_ENABLED = "false";
    process.env.STATE_DIR = stateDir;
    process.env.AUDIT_LOG_FILE = auditLog;
    process.env.VENDORS_DIR = join(import.meta.dirname, "../vendors");
    process.env.ENABLED_PROVIDERS = "adguardvpn";
    mkdirSync(hostCtlDir, { mode: 0o700 });

    vi.resetModules();
    const { handleHostRebootRequest } = await import("../proxy/src/host-control/host-reboot-handler.js");
    const { createGatewayChannelServer } = await import("../proxy/src/gateway-channel/control-server.js");
    const { createGatewayRequestHandler } = await import("../proxy/src/gateway-channel/gateway-routes.js");
    const rebootGuard = new GatewayGuard("eth0", async () => ({ exitCode: 0, stdout: "", stderr: "" }), { listenerAvailable: true, intervalMs: 60_000 });
    guards.push(rebootGuard);
    const handler = createGatewayRequestHandler({
      gatewayController: new GatewayController("eth0", "eth0", async () => ({ exitCode: 0, stdout: "", stderr: "" })),
      gatewayGuard: rebootGuard,
      dnsRelayController: createDnsRelayControllerFake(),
      explicitProxyController: createExplicitProxyControllerFake(),
      settingsRequestQueue: { run: (operation) => operation() },
      lanAddress: "192.0.2.1",
      dnsRelayPort: 53,
      lanCidr: "192.0.2.0/24",
      logAuditEvent: () => undefined,
    }, handleHostRebootRequest);
    const listener = await listenOnGatewaySocket(createGatewayChannelServer(handler, process.env), socketPath, process.getuid?.() ?? 0);
    listeners.push(listener);

    vi.resetModules();
    const { buildApp } = await import("../api/src/app.js");
    const { withAuthenticatedInject } = await import("../api/src/auth/test-support.js");
    const app = withAuthenticatedInject(buildApp({ logger: false }));
    const post = () => app.inject({ method: "POST", url: "/v1/gateway/reboot", payload: { password: "test-password-1234" } });

    const requested = await post();
    expect(requested.statusCode).toBe(202);
    expect(requested.json()).toEqual({ requested: true });
    const requestPath = join(hostCtlDir, "reboot-request");
    const requestStat = statSync(requestPath);
    expect(readFileSync(requestPath, "utf8")).toBe("vpngwgui-host-reboot-v1\n");
    expect(requestStat.mode & 0o777).toBe(0o600);
    expect(requestStat.uid).toBe(process.getuid?.());
    expect(requestStat.gid).toBe(process.getgid?.());

    expect((await post()).statusCode).toBe(409);
    unlinkSync(requestPath);
    rmSync(hostCtlDir, { recursive: true, force: true });
    expect((await post()).statusCode).toBe(503);
    await app.close();
  });
});

describe("API Gateway status route protection mismatch recovery", () => {
  it.each([
    { apiTls: false, gatewayTls: true, label: "API HTTP / Gateway mTLS" },
    { apiTls: true, gatewayTls: false, label: "API mTLS / Gateway HTTP" },
  ])("$label は専用status/logを返し、同じUDSで設定一致後に復旧する", async ({ apiTls, gatewayTls }) => {
    const directory = mkdtempSync(join(tmpdir(), "gateway-mismatch-integration-"));
    directories.push(directory);
    const socketPath = join(directory, "gateway.sock");
    const certificates = createTestCertificates(directory);
    Object.assign(process.env, {
      GATEWAY_SOCKET_PATH: socketPath,
      GATEWAY_TLS_ENABLED: String(apiTls),
      GATEWAY_TLS_CA_FILE: certificates.caPath,
      GATEWAY_TLS_CERT_FILE: certificates.serverCertPath,
      GATEWAY_TLS_KEY_FILE: certificates.serverKeyPath,
      GATEWAY_TLS_CLIENT_CERT_FILE: certificates.clientCertPath,
      GATEWAY_TLS_CLIENT_KEY_FILE: certificates.clientKeyPath,
      GATEWAY_TLS_SERVER_NAME: "localhost",
      VENDORS_DIR: join(import.meta.dirname, "../vendors"),
      ENABLED_PROVIDERS: "adguardvpn",
      AUDIT_LOG_FILE: join(directory, "audit.log"),
      STATE_DIR: directory,
    });

    const runNft = async () => ({ exitCode: 0, stdout: "", stderr: "" });
    const guard = new GatewayGuard("eth0", runNft, { listenerAvailable: false, intervalMs: 60_000 });
    guards.push(guard);
    const handler = createGatewayRequestHandler({
      gatewayController: new GatewayController("eth0", "eth0", runNft),
      gatewayGuard: guard,
      dnsRelayController: createDnsRelayControllerFake(),
      explicitProxyController: createExplicitProxyControllerFake(),
      settingsRequestQueue: { run: (operation) => operation() },
      lanAddress: "192.0.2.1",
      dnsRelayPort: 53,
      lanCidr: "192.0.2.0/24",
      logAuditEvent: () => undefined,
    });
    const gatewayEnv = { ...process.env, GATEWAY_TLS_ENABLED: String(gatewayTls) };
    const listener = await listenOnGatewaySocket(createGatewayChannelServer(handler, gatewayEnv), socketPath, process.getuid?.() ?? 0);
    listeners.push(listener);
    guard.setListenerAvailable(true);

    vi.resetModules();
    const { buildApp } = await import("../api/src/app.js");
    const { withAuthenticatedInject } = await import("../api/src/auth/test-support.js");
    const logOutput = new PassThrough();
    let capturedLogs = "";
    logOutput.on("data", (chunk: Buffer) => { capturedLogs += chunk.toString("utf8"); });
    const app = withAuthenticatedInject(buildApp({ logger: { level: "error", stream: logOutput } }));

    const mismatch = await app.inject({ method: "GET", url: "/v1/connection/gateway" });
    expect(mismatch.statusCode).toBe(502);
    expect(mismatch.json()).toMatchObject({ error: "gateway_protection_mismatch", protectionModeMismatch: true });
    expect(capturedLogs).toContain('"event":"protection_mode_mismatch"');
    expect(capturedLogs).not.toContain('"error":"proxy_unavailable"');

    process.env.GATEWAY_TLS_ENABLED = String(gatewayTls);
    vi.resetModules();
    const { notifySettings } = await import("../api/src/proxy-client/proxy-client.js");
    await notifySettings({ killSwitch: false, transparentGatewayEnabled: true, explicitProxyEnabled: false, explicitProxyAllowedCidrs: [] });
    vi.resetModules();
    const { buildApp: buildRecoveredApp } = await import("../api/src/app.js");
    const { withAuthenticatedInject: withRecoveredAuthentication } = await import("../api/src/auth/test-support.js");
    const recoveredApp = withRecoveredAuthentication(buildRecoveredApp({ logger: false }));
    const recovered = await recoveredApp.inject({ method: "GET", url: "/v1/connection/gateway" });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({ gatewayGuard: { state: "OFF", healthy: true } });

    await listener.close();
    const unavailable = await recoveredApp.inject({ method: "GET", url: "/v1/connection/gateway" });
    expect(unavailable.statusCode).toBe(502);
    expect(unavailable.json()).toMatchObject({ error: "proxy_unavailable" });
    await app.close();
    await recoveredApp.close();
  });
});
