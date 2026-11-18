// 責務: Web 実サーバの HTTP/HTTPS listener と TLS 起動失敗を確認する。

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startWebServer } from "./index.js";

const certPath = join(import.meta.dirname, "testdata", "web-test.crt");
const keyPath = join(import.meta.dirname, "testdata", "web-test.key");
const otherKeyPath = join(import.meta.dirname, "testdata", "other-test.key");
const runningServers: Awaited<ReturnType<typeof startWebServer>>[] = [];
const upstreamServers: HttpServer[] = [];

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
  await Promise.all(upstreamServers.splice(0).map((server) => closeServer(server)));
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

describe("Web same-origin API proxy", () => {
  it("/api prefix を除去して HTTP API へ転送する", async () => {
    const upstream = createHttpServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ url: request.url, method: request.method }));
    });
    const upstreamPort = await listen(upstream);
    upstreamServers.push(upstream);

    const web = await startWebServer({ API_ORIGIN: `http://127.0.0.1:${upstreamPort}` }, { port: 0, host: "127.0.0.1" });
    runningServers.push(web);
    const webPort = (web.server.address() as AddressInfo).port;
    const response = await httpRequestJson(webPort, "/api/v1/probe?mode=ready");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ url: "/v1/probe?mode=ready", method: "GET" });
  });

  it("API 不達時に 502 を返し、同じ proxy が復旧後の要求を転送する", async () => {
    const upstream = createHttpServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ recovered: true }));
    });
    const upstreamPort = await listen(upstream);
    upstreamServers.push(upstream);

    const web = await startWebServer({ API_ORIGIN: `http://127.0.0.1:${upstreamPort}` }, { port: 0, host: "127.0.0.1" });
    runningServers.push(web);
    const webPort = (web.server.address() as AddressInfo).port;

    await closeServer(upstream);
    expect((await httpRequestJson(webPort, "/api/v1/probe")).statusCode).toBe(502);

    const recoveredUpstream = createHttpServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ recovered: true }));
    });
    upstreamServers.push(recoveredUpstream);
    await listen(recoveredUpstream, upstreamPort);

    const recovered = await httpRequestJson(webPort, "/api/v1/probe");
    expect(recovered.statusCode).toBe(200);
    expect(recovered.body).toEqual({ recovered: true });
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

async function listen(server: HttpServer, port = 0): Promise<number> {
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: HttpServer): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function httpRequestJson(port: number, path: string): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body: unknown;
        try { body = JSON.parse(text); } catch { body = text; }
        resolve({ statusCode: res.statusCode ?? 0, body });
      });
    });
    req.on("error", reject);
    req.end();
  });
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
