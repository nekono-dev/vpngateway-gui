// 責務: ISP の HTTPS（echo と DoH）を模擬する（要件 5.1・6.1・8.5）。
// echo は要求元の IPv4 を text で返す（verifyEchoUrl と egress-probe が使う）。DoH は RFC 8484 の POST に答える。

import { createServer as createHttpsServer, type Server } from "node:https";
import { answerQuery } from "./isp-dns";
import type { Zone } from "./zone";

/** 起動した HTTPS の模擬サービス。 */
export interface IspHttps {
  readonly close: () => Promise<void>;
  /** DoH の応答を止める（SIGSTOP 相当の試験用の制御。6.3 で使う）。 */
  readonly pauseDoh: () => void;
  /** DoH の応答を再開する。 */
  readonly resumeDoh: () => void;
}

/**
 * 目的: 要求元の IPv4 アドレスを取り出す（IPv4 接続の送信元。::ffff: の接頭辞は外す）。
 * 入力: remoteAddress(ソケットの相手のアドレス)。
 * 出力: IPv4 の文字列。
 */
export function clientIpv4(remoteAddress: string | undefined): string {
  return (remoteAddress ?? "").replace(/^::ffff:/, "");
}

/**
 * 目的: echo と DoH を提供する HTTPS サーバを起動する。
 * 入力: host(待受 IPv4。例 198.51.100.254)、port(既定 443)、key・cert(サーバの秘密鍵と証明書の PEM)、zone(対応表)。
 * 出力: IspHttps。
 * 失敗時の方針: 待受に失敗したら例外を投げる。DoH の一時停止中は応答を保留し、再開で返す（上流の停止を再現する）。
 */
export async function startIspHttps(opts: {
  host: string;
  port?: number;
  key: Buffer;
  cert: Buffer;
  zone: Zone;
}): Promise<IspHttps> {
  let paused = false;
  const held: (() => void)[] = [];

  const server: Server = createHttpsServer({ key: opts.key, cert: opts.cert }, (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(`${clientIpv4(req.socket.remoteAddress)}\n`);
      return;
    }
    // 中継は ClientID を /dns-query/<ID> のようにパスへ追記して送る（proxy/src/dns-relay/upstream.ts）ため、接頭辞で判定する
    if (req.method === "POST" && req.url !== undefined && (req.url === "/dns-query" || req.url.startsWith("/dns-query/"))) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const respond = () => {
          const reply = answerQuery(opts.zone, Buffer.concat(chunks), false);
          if (reply === null) {
            res.writeHead(400);
            res.end();
            return;
          }
          res.writeHead(200, { "content-type": "application/dns-message", "content-length": String(reply.length) });
          res.end(reply);
        };
        if (paused) held.push(respond);
        else respond();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 443, opts.host, () => resolve());
  });

  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    pauseDoh: () => {
      paused = true;
    },
    resumeDoh: () => {
      paused = false;
      for (const respond of held.splice(0)) respond();
    },
  };
}
