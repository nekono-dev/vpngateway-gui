// 責務: ISP の平文 DNS（UDP・TCP の 53 番）を模擬する。DoH と同じ対応表を参照する（要件 6.2・6.4）。

import { createSocket } from "node:dgram";
import { createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { decode, encode, type Packet } from "dns-packet";
import { lookupA, type Zone } from "./zone";

/** DNS の RCODE: 0 は NOERROR、3 は NXDOMAIN。 */
const RCODE_NOERROR = 0x8180;
const RCODE_NXDOMAIN = 0x8183;

/**
 * 目的: 問い合わせのバイト列へ応答のバイト列を作る（A レコードの問い合わせだけに答える）。
 * 入力: zone(対応表)、query(問い合わせの DNS メッセージ)、direct(直接の応答を優先するか)。
 * 出力: 応答の DNS メッセージ。解釈できない問い合わせは null（応答しない）。
 */
export function answerQuery(zone: Zone, query: Buffer, direct: boolean): Buffer | null {
  let packet: Packet;
  try {
    packet = decode(query);
  } catch {
    return null;
  }
  const question = packet.questions?.[0];
  if (question === undefined || question.type !== "A") {
    return encode({ type: "response", id: packet.id, flags: RCODE_NXDOMAIN, questions: packet.questions ?? [], answers: [] });
  }
  const ip = lookupA(zone, question.name, direct);
  if (ip === null) {
    return encode({ type: "response", id: packet.id, flags: RCODE_NXDOMAIN, questions: [question], answers: [] });
  }
  return encode({
    type: "response",
    id: packet.id,
    flags: RCODE_NOERROR,
    questions: [question],
    answers: [{ type: "A", name: question.name, ttl: 60, data: ip }],
  });
}

/** 起動した平文 DNS の待受（停止に使う）。 */
export interface IspDns {
  readonly close: () => Promise<void>;
}

/**
 * 目的: 平文 DNS（UDP と TCP）を指定のアドレスで待ち受ける。
 * 入力: host(待受の IPv4。例 192.168.50.254)、port(既定 53)、zone(対応表)。
 * 出力: 停止の関数を持つ IspDns。
 * 失敗時の方針: 待受に失敗したら例外（呼び出し側が準備の失敗として扱う）。
 */
export async function startIspDns(host: string, zone: Zone, port = 53): Promise<IspDns> {
  const udp = createSocket("udp4");
  udp.on("message", (msg, rinfo) => {
    // 平文 DNS は直接の応答（directAnswers）を返す。中継（DoH）経由との違いで、53 番リダイレクトの通過を判定する（6.2）
    const reply = answerQuery(zone, msg, true);
    if (reply !== null) udp.send(reply, rinfo.port, rinfo.address);
  });
  await new Promise<void>((resolve, reject) => {
    udp.once("error", reject);
    udp.bind(port, host, () => resolve());
  });

  const tcp: TcpServer = createTcpServer((socket) => {
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      // TCP の DNS は 2 バイトの長さの接頭辞を持つ
      while (buffered.length >= 2) {
        const length = buffered.readUInt16BE(0);
        if (buffered.length < 2 + length) break;
        const reply = answerQuery(zone, buffered.subarray(2, 2 + length), true);
        buffered = buffered.subarray(2 + length);
        if (reply !== null) {
          const prefix = Buffer.alloc(2);
          prefix.writeUInt16BE(reply.length, 0);
          socket.write(Buffer.concat([prefix, reply]));
        }
      }
    });
    socket.on("error", () => socket.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    tcp.once("error", reject);
    tcp.listen(port, host, () => resolve());
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        udp.close();
        tcp.close(() => resolve());
      }),
  };
}
