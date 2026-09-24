// 責務: 上流への転送（upstream.ts）の単体テスト。DoHはテスト用に生成した自己署名CAとローカルのHTTPSサーバで、
// 平文DNSはローカルのUDPサーバで検証する。

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { createSocket } from "node:dgram";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTcpServer, type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAnswer } from "./dns-message.js";
import { buildDohUrl, forwardDoh, forwardPlain } from "./upstream.js";
import { buildAnswer, buildQuery } from "./test-helpers.js";

describe("buildDohUrl", () => {
  it("パスの末尾にClientIDを追加する（末尾のスラッシュは重ねない）", () => {
    expect(buildDohUrl("https://dns.example/dns-query", "mac-aa").pathname).toBe("/dns-query/mac-aa");
    expect(buildDohUrl("https://dns.example/dns-query/", "mac-aa").pathname).toBe("/dns-query/mac-aa");
  });
});

describe("forwardDoh", () => {
  let server: HttpsServer;
  let port: number;
  let caPem: string;
  const requests: { url: string; contentType: string | undefined }[] = [];

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "dns-relay-test-"));
    // localhost用の自己署名証明書（自身がCAを兼ねる）。
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
      "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
      "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ], { stdio: "ignore" });
    caPem = readFileSync(join(dir, "cert.pem"), "utf8");
    server = createHttpsServer({ key: readFileSync(join(dir, "key.pem")), cert: caPem }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        requests.push({ url: req.url ?? "", contentType: req.headers["content-type"] });
        if (req.url?.includes("/broken")) {
          res.writeHead(500).end();
          return;
        }
        const query = Buffer.concat(chunks);
        res.writeHead(200, { "content-type": "application/dns-message" });
        res.end(buildAnswer("example.com", [{ address: "192.0.2.1", ttl: 60 }], 0, query.readUInt16BE(0)));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  it("CAを登録すれば、ClientID付きのパスへPOSTして応答を得る", async () => {
    const query = buildQuery("example.com", 0x4242);
    const response = await forwardDoh(`https://localhost:${port}/dns-query`, caPem, query, "mac-aa-bb");
    expect(response.readUInt16BE(0)).toBe(0x4242);
    expect(requests.at(-1)).toEqual({ url: "/dns-query/mac-aa-bb", contentType: "application/dns-message" });
  });

  it("CAを登録しなければ証明書の検証に失敗する（検証は無効化しない）", async () => {
    await expect(forwardDoh(`https://localhost:${port}/dns-query`, "", buildQuery("example.com"), "x")).rejects.toThrow();
  });

  it("200以外のステータスは失敗として扱う", async () => {
    await expect(forwardDoh(`https://localhost:${port}/broken`, caPem, buildQuery("example.com"), "x")).rejects.toThrow(/status 500/);
  });

  it("接続できない上流は失敗として扱う", async () => {
    await expect(forwardDoh("https://localhost:1/dns-query", caPem, buildQuery("example.com"), "x", 1000)).rejects.toThrow();
  });
});

describe("forwardPlain", () => {
  it("UDPで問い合わせて応答を返す", async () => {
    const udp = createSocket("udp4");
    await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
    udp.on("message", (message, remote) => {
      udp.send(buildAnswer("example.com", [{ address: "192.0.2.9", ttl: 5 }], 0, message.readUInt16BE(0)), remote.port, remote.address);
    });
    const port = udp.address().port;
    const response = await forwardPlain(["127.0.0.1"], buildQuery("example.com", 7), 1000, port);
    expect(response.readUInt16BE(0)).toBe(7);
    udp.close();
  });

  it("応答が切り詰められていたらTCPで取り直す", async () => {
    const udp = createSocket("udp4");
    await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
    const port = udp.address().port;
    udp.on("message", (message, remote) => {
      const truncated = buildAnswer("example.com", [], 0, message.readUInt16BE(0));
      truncated.writeUInt16BE(truncated.readUInt16BE(2) | 0x0200, 2);
      udp.send(truncated, remote.port, remote.address);
    });
    const tcp = createTcpServer((socket) => {
      socket.on("data", (data) => {
        const full = buildAnswer("example.com", [{ address: "192.0.2.10", ttl: 5 }], 0, data.readUInt16BE(2));
        const frame = Buffer.alloc(2 + full.length);
        frame.writeUInt16BE(full.length, 0);
        full.copy(frame, 2);
        socket.write(frame);
      });
    });
    await new Promise<void>((resolve) => tcp.listen(port, "127.0.0.1", resolve));
    const response = await forwardPlain(["127.0.0.1"], buildQuery("example.com", 9), 1000, port);
    expect(parseAnswer(response)?.aRecords).toEqual([{ address: "192.0.2.10", ttl: 5 }]);
    udp.close();
    tcp.close();
  });

  it("最初のサーバが応答しなくても次のサーバを試し、全滅なら例外", async () => {
    const udp = createSocket("udp4");
    await new Promise<void>((resolve) => udp.bind(0, "127.0.0.2", resolve));
    const port = udp.address().port;
    udp.on("message", (message, remote) => {
      udp.send(buildAnswer("example.com", [], 0, message.readUInt16BE(0)), remote.port, remote.address);
    });
    // 127.0.0.3は同じポートで待ち受けていないため応答が無い。
    const response = await forwardPlain(["127.0.0.3", "127.0.0.2"], buildQuery("example.com", 5), 300, port);
    expect(response.readUInt16BE(0)).toBe(5);
    await expect(forwardPlain(["127.0.0.3"], buildQuery("example.com"), 300, port)).rejects.toThrow();
    udp.close();
  });
});
