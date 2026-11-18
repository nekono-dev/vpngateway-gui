// 責務: Web 実サーバの HTTP/HTTPS listener と TLS 起動失敗を確認する。

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { once } from "node:events";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startWebServer } from "./index.js";

const certPath = join(import.meta.dirname, "testdata", "web-test.crt");
const keyPath = join(import.meta.dirname, "testdata", "web-test.key");
const otherKeyPath = join(import.meta.dirname, "testdata", "other-test.key");
const runningServers: Awaited<ReturnType<typeof startWebServer>>[] = [];

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
});

describe("Web HTTP/HTTPS listener", () => {
  it.each([undefined, "false"])('flag が %s の場合は証明書なしで HTTP listen する', async (enabled) => {
    const server = await startWebServer({ WEB_HTTPS_ENABLED: enabled }, { port: 0, host: "127.0.0.1" });
    runningServers.push(server);
    const port = (server.server.address() as AddressInfo).port;
    const response = await request(httpRequest, port);
    expect(response.statusCode).toBeLessThan(500);
  });

  it("HTTPS が有効なら TLS handshake 後に応答する", async () => {
    const server = await startWebServer({
      WEB_HTTPS_ENABLED: "true",
      WEB_TLS_CERT_FILE: certPath,
      WEB_TLS_KEY_FILE: keyPath,
    }, { port: 0, host: "127.0.0.1" });
    runningServers.push(server);
    const port = (server.server.address() as AddressInfo).port;
    const response = await request(httpsRequest, port);
    expect(response.statusCode).toBeLessThan(500);
  });

  it.each([
    ["不一致証明書", { WEB_HTTPS_ENABLED: "true", WEB_TLS_CERT_FILE: certPath, WEB_TLS_KEY_FILE: otherKeyPath }],
    ["証明書ファイル欠落", { WEB_HTTPS_ENABLED: "true", WEB_TLS_CERT_FILE: "/missing/cert.pem", WEB_TLS_KEY_FILE: keyPath }],
    ["不正な PEM", { WEB_HTTPS_ENABLED: "true", WEB_TLS_CERT_FILE: keyPath, WEB_TLS_KEY_FILE: keyPath }],
    ["不正な flag", { WEB_HTTPS_ENABLED: "yes" }],
  ])("%s では起動に失敗し、port に listener を作らない", async (_label, env) => {
    const port = await unusedPort();
    await expect(startWebServer(env, { port, host: "127.0.0.1" })).rejects.toThrow();
    await expectConnectionRefused(port);
  });
});

function request(requester: typeof httpRequest | typeof httpsRequest, port: number): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    const req = requester({ host: "127.0.0.1", port, path: "/", rejectUnauthorized: false }, (res) => {
      res.resume();
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0 }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function unusedPort(): Promise<number> {
  const { createServer } = await import("node:net");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function expectConnectionRefused(port: number): Promise<void> {
  await expect(new Promise<void>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, timeout: 500 }, (res) => {
      res.resume();
      reject(new Error(`unexpected listener returned ${res.statusCode}`));
    });
    req.on("error", (error) => error.message.includes("ECONNREFUSED") ? resolve() : reject(error));
    req.end();
  })).resolves.toBeUndefined();
}
