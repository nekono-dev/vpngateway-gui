// 責務: 共有の API クライアントの単体テスト。CA の検証・Cookie の保持・タイムアウトを、実際の TLS サーバで確かめる。

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applySetCookie, createApiClient, cookieHeader } from "./api-client";

let dir: string;
let serverCaPath: string;
let otherCaPath: string;
let httpsServer: HttpsServer;
let httpServer: HttpServer;
let httpsBaseUrl: string;
let httpBaseUrl: string;

/** 目的: openssl で CA と、SAN に 127.0.0.1 を含むサーバ証明書を作る（テストごとに一時ディレクトリへ）。 */
function makeCa(name: string): { caCert: string; caKey: string } {
  const caKey = join(dir, `${name}.key`);
  const caCert = join(dir, `${name}.crt`);
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-keyout", caKey, "-out", caCert, "-days", "1", "-subj", `/CN=${name}`,
  ], { stdio: "ignore" });
  return { caCert, caKey };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-client-test-"));
  const ca = makeCa("test-ca");
  serverCaPath = ca.caCert;
  otherCaPath = makeCa("other-ca").caCert;

  const serverKey = join(dir, "server.key");
  const serverCsr = join(dir, "server.csr");
  const serverCert = join(dir, "server.crt");
  const ext = join(dir, "ext.cnf");
  writeFileSync(ext, "subjectAltName=IP:127.0.0.1\n");
  execFileSync("openssl", ["req", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", serverKey, "-out", serverCsr, "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
  execFileSync("openssl", ["x509", "-req", "-in", serverCsr, "-CA", ca.caCert, "-CAkey", ca.caKey, "-CAcreateserial", "-out", serverCert, "-days", "1", "-extfile", ext], { stdio: "ignore" });

  const handler = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void => {
    if (req.url === "/api/v1/login" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "vpngwgui_session=abc; Path=/; HttpOnly" });
      res.end(JSON.stringify({ loggedIn: true }));
      return;
    }
    if (req.url === "/api/v1/check") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ cookie: req.headers.cookie ?? "" }));
      return;
    }
    if (req.url === "/api/v1/slow") {
      setTimeout(() => {
        res.writeHead(200);
        res.end("{}");
      }, 300);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found", message: "見つかりません" }));
  };
  httpsServer = createHttpsServer({ key: readFileSync(serverKey), cert: readFileSync(serverCert) }, handler);
  httpServer = createHttpServer(handler);
  await Promise.all([
    new Promise<void>((resolve) => httpsServer.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve)),
  ]);
  httpsBaseUrl = `https://127.0.0.1:${(httpsServer.address() as AddressInfo).port}`;
  httpBaseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(() => {
  httpsServer.close();
  httpServer.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("applySetCookie と cookieHeader", () => {
  it("Set-Cookie の名前と値を保持し、Cookie ヘッダの値に組み立てる", () => {
    const jar = new Map<string, string>();
    applySetCookie(jar, ["vpngwgui_session=abc; Path=/; HttpOnly"]);
    expect(cookieHeader(jar)).toBe("vpngwgui_session=abc");
  });

  it("Max-Age=0 の Cookie は削除する", () => {
    const jar = new Map([["vpngwgui_session", "abc"]]);
    applySetCookie(jar, ["vpngwgui_session=; Max-Age=0; Path=/"]);
    expect(cookieHeader(jar)).toBe("");
  });
});

describe("createApiClient", () => {
  it("CA で検証できない証明書を拒否し、transport の失敗として返す", async () => {
    const client = createApiClient({ baseUrl: httpsBaseUrl, caPath: otherCaPath });
    const result = await client.get("/v1/check");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("transport");
  });

  it("CA で検証できる証明書に接続し、Set-Cookie の値を次の要求で送る", async () => {
    const client = createApiClient({ baseUrl: httpsBaseUrl, caPath: serverCaPath });
    const login = await client.post<{ loggedIn: boolean }>("/v1/login", {});
    expect(login).toEqual({ ok: true, status: 200, body: { loggedIn: true } });

    const check = await client.get<{ cookie: string }>("/v1/check");
    expect(check).toEqual({ ok: true, status: 200, body: { cookie: "vpngwgui_session=abc" } });
  });

  it("HTTP の失敗は、error と message を持つ http の失敗として返す", async () => {
    const client = createApiClient({ baseUrl: httpsBaseUrl, caPath: serverCaPath });
    const result = await client.get("/v1/missing");
    expect(result).toEqual({ ok: false, kind: "http", status: 404, error: "not_found", message: "見つかりません" });
  });

  it("タイムアウトを過ぎた要求は transport の失敗として返す", async () => {
    const client = createApiClient({ baseUrl: httpsBaseUrl, caPath: serverCaPath });
    const result = await client.get("/v1/slow", 50);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("transport");
  });

  it("HTTP Web origin を使い、API CA なしで /api/v1 へ要求する", async () => {
    const client = createApiClient({ baseUrl: httpBaseUrl });
    const result = await client.get<{ cookie: string }>("/v1/check");
    expect(result).toEqual({ ok: true, status: 200, body: { cookie: "" } });
  });

  it("HTTPS で CA 未指定なら標準 trust store の検証に失敗する自己署名証明書を拒否する", async () => {
    const client = createApiClient({ baseUrl: httpsBaseUrl });
    const result = await client.get("/v1/check");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("transport");
  });
});
