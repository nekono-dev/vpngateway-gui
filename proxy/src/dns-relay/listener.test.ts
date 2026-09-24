// 責務: DNS中継のUDP/TCP待受（listener.ts）の単体テスト。実ソケットでループバックへ問い合わせる。

import { createSocket } from "node:dgram";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DnsListener } from "./listener.js";
import { buildAnswer, buildQuery } from "./test-helpers.js";

function freePort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}

describe("DnsListener", () => {
  let listener: DnsListener | undefined;
  afterEach(async () => {
    await listener?.stop();
    listener = undefined;
  });

  it("UDPの問い合わせにハンドラの応答を返し、問い合わせ元のIPを渡す", async () => {
    const port = freePort();
    const seen: string[] = [];
    listener = new DnsListener();
    await listener.start(["127.0.0.1"], port, async (query, clientIp) => {
      seen.push(clientIp);
      return buildAnswer("example.com", [{ address: "192.0.2.1", ttl: 60 }], 0, query.readUInt16BE(0));
    });
    const client = createSocket("udp4");
    const reply = await new Promise<Buffer>((resolve) => {
      client.on("message", resolve);
      client.send(buildQuery("example.com", 0x77), port, "127.0.0.1");
    });
    client.close();
    expect(reply.readUInt16BE(0)).toBe(0x77);
    expect(seen).toEqual(["127.0.0.1"]);
  });

  it("UDPで返せる大きさ（EDNS無しは512）を超える応答はTCビット付きに切り詰める", async () => {
    const port = freePort();
    listener = new DnsListener();
    await listener.start(["127.0.0.1"], port, async (query) => {
      const records = Array.from({ length: 60 }, (_, index) => ({ address: `192.0.2.${index}`, ttl: 60 }));
      return buildAnswer("example.com", records, 0, query.readUInt16BE(0));
    });
    const client = createSocket("udp4");
    const reply = await new Promise<Buffer>((resolve) => {
      client.on("message", resolve);
      client.send(buildQuery("example.com"), port, "127.0.0.1");
    });
    client.close();
    expect(reply.readUInt16BE(2) & 0x0200).toBe(0x0200);
  });

  it("TCPは2バイト長のフレームで、複数の問い合わせを1接続で処理する", async () => {
    const port = freePort();
    listener = new DnsListener();
    await listener.start(["127.0.0.1"], port, async (query) => buildAnswer("example.com", [], 0, query.readUInt16BE(0)));
    const ids = await new Promise<number[]>((resolve) => {
      const received: number[] = [];
      let buffer = Buffer.alloc(0);
      const socket = connect(port, "127.0.0.1", () => {
        for (const id of [1, 2]) {
          const query = buildQuery("example.com", id);
          const frame = Buffer.alloc(2 + query.length);
          frame.writeUInt16BE(query.length, 0);
          query.copy(frame, 2);
          socket.write(frame);
        }
      });
      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2 && buffer.length >= 2 + buffer.readUInt16BE(0)) {
          received.push(buffer.readUInt16BE(2));
          buffer = buffer.subarray(2 + buffer.readUInt16BE(0));
        }
        if (received.length === 2) {
          socket.destroy();
          resolve(received);
        }
      });
    });
    expect(ids.sort()).toEqual([1, 2]);
  });

  it("ポートが使用中なら例外を投げ、開いたソケットを残さない", async () => {
    const port = freePort();
    listener = new DnsListener();
    await listener.start(["127.0.0.1"], port, async () => undefined);
    const second = new DnsListener();
    await expect(second.start(["127.0.0.1"], port, async () => undefined)).rejects.toThrow();
  });
});
