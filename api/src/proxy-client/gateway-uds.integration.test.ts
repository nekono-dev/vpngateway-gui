// 責務: 実 UDS listener の停止・socket 消失・再作成後に API Gateway client が再接続できることを確認する。

import { createServer, type Server } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { performance } from "node:perf_hooks";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let directory: string;
let socketPath: string;

const status = {
  transparentGateway: { state: "stopped", killSwitchBlocking: false },
  explicitProxy: { state: "stopped", restartCount: 0 },
  gatewayGuard: { state: "OFF", healthy: true, leaseValid: false, lastUpdatedAt: null },
};

async function listen(): Promise<Server> {
  mkdirSync(directory, { recursive: true });
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(status));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return server;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const testCertificateDirectory = join(import.meta.dirname, "../../../web/server/testdata");
const testCertificate = readFileSync(join(testCertificateDirectory, "web-test.crt"));
const testPrivateKey = readFileSync(join(testCertificateDirectory, "web-test.key"));

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "gateway-uds-client-"));
  socketPath = join(directory, "gateway.sock");
  process.env.GATEWAY_TLS_ENABLED = "false";
  process.env.GATEWAY_SOCKET_PATH = socketPath;
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  delete process.env.GATEWAY_SOCKET_PATH;
  delete process.env.GATEWAY_TLS_ENABLED;
  delete process.env.GATEWAY_TLS_CA_FILE;
  delete process.env.GATEWAY_TLS_CLIENT_CERT_FILE;
  delete process.env.GATEWAY_TLS_CLIENT_KEY_FILE;
  delete process.env.GATEWAY_TLS_SERVER_NAME;
  vi.resetModules();
});

describe("Gateway UDS reconnect", () => {
  it("socket disappear/ECONNREFUSED を unavailable と報告し、再作成後に再接続する", async () => {
    let server = await listen();
    vi.resetModules();
    const { fetchProxyStatus } = await import("./proxy-client.js");
    await expect(fetchProxyStatus()).resolves.toMatchObject(status);

    await close(server);
    await expect(fetchProxyStatus()).rejects.toThrow(/failed to connect to gateway control channel/);

    server = await listen();
    await expect(fetchProxyStatus()).resolves.toMatchObject(status);
    await close(server);
  });

  it("HTTP client が TLS listener の reset を TLS probe で確認して保護方式不一致にする", async () => {
    mkdirSync(directory, { recursive: true });
    const server = createTlsServer({
      cert: testCertificate,
      key: testPrivateKey,
      ca: testCertificate,
      requestCert: true,
      rejectUnauthorized: true,
    }, (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(status));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    vi.resetModules();
    const { fetchProxyStatus } = await import("./proxy-client.js");

    await expect(fetchProxyStatus()).rejects.toThrow("API と Gateway の通信保護設定が一致しません");
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("TLS client が plain HTTP listener を検出して保護方式不一致にする", async () => {
    const server = await listen();
    process.env.GATEWAY_TLS_ENABLED = "true";
    process.env.GATEWAY_TLS_CA_FILE = join(testCertificateDirectory, "web-test.crt");
    process.env.GATEWAY_TLS_CLIENT_CERT_FILE = join(testCertificateDirectory, "web-test.crt");
    process.env.GATEWAY_TLS_CLIENT_KEY_FILE = join(testCertificateDirectory, "web-test.key");
    process.env.GATEWAY_TLS_SERVER_NAME = "localhost";
    vi.resetModules();
    const { fetchProxyStatus } = await import("./proxy-client.js");

    await expect(fetchProxyStatus()).rejects.toThrow("API と Gateway の通信保護設定が一致しません");
    await close(server);
  });

  it("5 秒の通知期限に backoff 待機と response body 待ちを含める", async () => {
    let server = await listen();
    vi.resetModules();
    const client = await import("./proxy-client.js");
    await expect(client.fetchProxyStatus()).resolves.toMatchObject(status);
    await close(server);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(client.fetchProxyStatus()).rejects.toThrow(/failed to connect/);
    }

    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
      response.write("{");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    const startedAt = performance.now();
    await expect(client.notifySettings({ killSwitch: false })).rejects.toThrow(/within timeout|total deadline/);
    expect(performance.now() - startedAt).toBeLessThan(5100);
    await close(server);
  }, 9000);

  it("mTLS over UDS でCA・SAN・client certificateを検証し、SAN不一致を拒否する", async () => {
    const server = createTlsServer({
      cert: testCertificate,
      key: testPrivateKey,
      ca: testCertificate,
      requestCert: true,
      rejectUnauthorized: true,
    }, (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(status));
    });
    mkdirSync(directory, { recursive: true });
    process.env.GATEWAY_SOCKET_PATH = socketPath;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    process.env.GATEWAY_TLS_ENABLED = "true";
    process.env.GATEWAY_TLS_CA_FILE = join(testCertificateDirectory, "web-test.crt");
    process.env.GATEWAY_TLS_CLIENT_CERT_FILE = join(testCertificateDirectory, "web-test.crt");
    process.env.GATEWAY_TLS_CLIENT_KEY_FILE = join(testCertificateDirectory, "web-test.key");
    process.env.GATEWAY_TLS_SERVER_NAME = "localhost";
    vi.resetModules();
    const { fetchProxyStatus } = await import("./proxy-client.js");
    await expect(fetchProxyStatus()).resolves.toMatchObject(status);

    process.env.GATEWAY_TLS_SERVER_NAME = "gateway.invalid";
    vi.resetModules();
    const mismatchClient = await import("./proxy-client.js");
    await expect(mismatchClient.fetchProxyStatus()).rejects.toThrow(/failed to connect to gateway control channel/);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
});
