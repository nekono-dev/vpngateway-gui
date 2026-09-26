// 責務: 設定の動作検証のL2で、ゲートウェイ自身から中継リゾルバへUDPで名前を問い合わせる。送信元を検証専用のアドレス
// （127.0.0.2）にし、中継リゾルバが検証専用のClientIDで上流へ転送するようにする（dns-relay/client-id.ts）。

import { createSocket } from "node:dgram";
import { randomInt } from "node:crypto";
import { buildAQuery, parseAnswer, type DnsAnswer } from "../dns-relay/dns-message.js";
import { SELF_CHECK_SOURCE_ADDRESS } from "../dns-relay/client-id.js";

// 中継リゾルバの上流への待ち時間（5秒）とフォールバックを見込んだ待ち時間。
const QUERY_TIMEOUT_MS = 8000;

/**
 * 目的: 中継リゾルバ（127.0.0.1の待受）へAレコードを問い合わせる。
 * 入力: name(問い合わせ名), port(中継リゾルバの待受ポート), timeoutMs(待ち時間)。
 * 出力: 応答の解析結果。送信できない・応答が無い・形式が不正ならundefined。
 */
export function queryRelay(name: string, port: number, timeoutMs = QUERY_TIMEOUT_MS): Promise<DnsAnswer | undefined> {
  const id = randomInt(0x10000);
  const query = buildAQuery(name, id);
  if (query === undefined) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    let settled = false;
    const finish = (answer: DnsAnswer | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(answer);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    socket.on("error", () => finish(undefined));
    socket.on("message", (message) => {
      if (message.length < 2 || message.readUInt16BE(0) !== id) return;
      finish(parseAnswer(message));
    });
    socket.bind(0, SELF_CHECK_SOURCE_ADDRESS, () => {
      socket.send(query, port, "127.0.0.1", (error) => {
        if (error) finish(undefined);
      });
    });
  });
}
