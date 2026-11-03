// 責務: ISP の模擬サービス（echo・DoH・平文 DNS）の単体テスト。対応表を参照し、送信元 IP を返すことを確かめる（要件 5.1・6.1・6.2）。
// 証明書は certs.sh で一時ディレクトリに作り、テスト後に消す（リポジトリに秘密鍵を残さない）。

import { execFileSync } from "node:child_process";
import { createSocket } from "node:dgram";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode, decode } from "dns-packet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startIspDns, answerQuery, type IspDns } from "./isp-dns";
import { startIspHttps, type IspHttps } from "./isp-https";
import { loadZone, lookupA, DEFAULT_ZONE_PATH } from "./zone";

const HOST = "127.0.0.1";
const DNS_PORT = 15353;
const zone = loadZone(DEFAULT_ZONE_PATH);
const certDir = mkdtempSync(join(tmpdir(), "isp-test-"));
let https: IspHttps;
let dns: IspDns;
let ca: Buffer;

beforeAll(async () => {
  execFileSync("sh", ["e2e/hosted/lib/certs.sh", certDir], { stdio: "ignore" });
  ca = readFileSync(join(certDir, "ca.crt"));
  https = await startIspHttps({
    host: HOST,
    port: 18443,
    key: readFileSync(join(certDir, "server.key")),
    cert: readFileSync(join(certDir, "server.crt")),
    zone,
  });
  dns = await startIspDns(HOST, zone, DNS_PORT);
});

afterAll(async () => {
  await https.close();
  await dns.close();
  rmSync(certDir, { recursive: true, force: true });
});

/** 目的: CA で検証する HTTPS 要求を送る（テストの補助）。 */
function call(method: string, path: string, body?: Buffer): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({ host: HOST, port: 18443, path, method, ca, headers: body ? { "content-type": "application/dns-message", "content-length": body.length } : {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

/** 目的: 平文 DNS（UDP）へ A の問い合わせを送り、応答を得る（テストの補助）。 */
function udpQuery(name: string): Promise<ReturnType<typeof decode>> {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    const query = encode({ type: "query", id: 4242, flags: 0x0100, questions: [{ type: "A", name }] });
    socket.on("message", (msg) => {
      socket.close();
      resolve(decode(msg));
    });
    socket.on("error", reject);
    socket.send(query, DNS_PORT, HOST);
  });
}

describe("echo（送信元 IP を返す）", () => {
  it("GET / は要求元の IPv4 を改行付きの text で返す", async () => {
    const res = await call("GET", "/");
    expect(res.status).toBe(200);
    expect(res.body.toString("utf8")).toBe("127.0.0.1\n");
  });
});

describe("DoH（RFC 8484 の POST）", () => {
  it("対応表にある名前を、対応する A レコードで答える", async () => {
    const query = encode({ type: "query", id: 1, flags: 0x0100, questions: [{ type: "A", name: "echo.bypass.test" }] });
    const res = await call("POST", "/dns-query", query);
    expect(res.status).toBe(200);
    const answer = decode(res.body);
    expect(answer.answers?.[0]).toMatchObject({ type: "A", data: "198.51.100.254" });
  });

  it("対応表にない名前は NXDOMAIN（RCODE 3）で答える", async () => {
    const query = encode({ type: "query", id: 2, flags: 0x0100, questions: [{ type: "A", name: "unknown.example" }] });
    const res = await call("POST", "/dns-query", query);
    expect(res.body.readUInt16BE(2) & 0x000f).toBe(3);
  });
});

describe("平文 DNS（UDP）", () => {
  it("DoH と同じ対応表を参照して答える", async () => {
    const answer = await udpQuery("dns.e2e.test");
    expect(answer.answers?.[0]).toMatchObject({ type: "A", data: "198.51.100.254" });
  });

  it("直接の応答（directAnswers）は中継の対応表より優先される", () => {
    const query = encode({ type: "query", id: 3, flags: 0x0100, questions: [{ type: "A", name: "redirect.e2e.test" }] });
    const direct = decode(answerQuery(zone, query, true) ?? Buffer.alloc(0));
    expect(direct.answers?.[0]).toMatchObject({ data: "203.0.113.99" });
    expect(lookupA(zone, "redirect.e2e.test")).toBeNull();
  });
});
