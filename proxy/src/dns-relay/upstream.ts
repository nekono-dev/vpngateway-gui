// 責務: DNS問い合わせの上流への転送。DoH（自宅DNSサーバ。ClientIDをパスに付与）と、平文DNS（フォールバック先の公開DNS）。
// proxyserver/design.md「DNS中継リゾルバ」の「上流への転送」に対応する。

import { request } from "node:https";
import { rootCertificates } from "node:tls";
import { createSocket } from "node:dgram";
import { connect } from "node:net";

export const UPSTREAM_TIMEOUT_MS = 5000;

export type UpstreamForwarder = (query: Buffer, clientId: string) => Promise<Buffer>;

/**
 * 目的: DoH上流（RFC 8484のPOST）のURLへClientIDを付けた転送先URLを作る。
 * 入力: baseUrl(`https://dns.home.example/dns-query`等), clientId(ClientID)。
 * 出力: `<baseUrl>/<clientId>`（baseUrlの末尾のスラッシュは重ねない）。
 */
export function buildDohUrl(baseUrl: string, clientId: string): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${clientId}`;
  return url;
}

/**
 * 目的: DoH上流へ問い合わせを転送し、応答メッセージを返す。
 * 入力: baseUrl(上流のDoH URL), caPem(上流のサーバ証明書を検証するCA。空ならシステムのCAのみ), query(DNSクエリ),
 *      clientId(ClientID), timeoutMs(タイムアウト)。
 * 出力: 応答メッセージ。
 * 失敗時の方針: 接続失敗・証明書検証失敗・タイムアウト・200以外のステータスは例外（呼び出し元が障害として扱う）。
 */
export function forwardDoh(
  baseUrl: string,
  caPem: string,
  query: Buffer,
  clientId: string,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const url = buildDohUrl(baseUrl, clientId);
    const req = request(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/dns-message", accept: "application/dns-message", "content-length": query.length },
        // 検証は常に有効。利用者が登録したCAは、システムのCAに追加する。
        ca: caPem.trim().length > 0 ? [...rootCertificates, caPem] : undefined,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(Buffer.concat(chunks));
          } else {
            reject(new Error(`upstream status ${res.statusCode}`));
          }
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("upstream timeout")));
    req.on("error", reject);
    req.end(query);
  });
}

function forwardUdp(server: string, port: number, query: Buffer, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("fallback timeout"));
    }, timeoutMs);
    socket.on("message", (message) => {
      clearTimeout(timer);
      socket.close();
      resolve(message);
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
    socket.send(query, port, server);
  });
}

function forwardTcp(server: string, port: number, query: Buffer, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, server);
    const chunks: Buffer[] = [];
    let received = 0;
    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error("fallback timeout")));
    socket.on("error", fail);
    socket.on("connect", () => {
      const frame = Buffer.alloc(2 + query.length);
      frame.writeUInt16BE(query.length, 0);
      query.copy(frame, 2);
      socket.write(frame);
    });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      received += chunk.length;
      const all = Buffer.concat(chunks);
      if (all.length >= 2 && received >= 2 + all.readUInt16BE(0)) {
        socket.destroy();
        resolve(all.subarray(2, 2 + all.readUInt16BE(0)));
      }
    });
  });
}

/**
 * 目的: フォールバック先（平文DNS）へ転送する。UDPで問い合わせ、応答が切り詰められていればTCPで再取得する。
 *      指定順に試し、最初に得られた応答を返す。
 * 入力: servers(IPv4アドレスの一覧), query(DNSクエリ), timeoutMs(1サーバあたりのタイムアウト), port(既定53。テスト用)。
 * 出力: 応答メッセージ。
 * 失敗時の方針: すべてのサーバで失敗した場合は例外。
 */
export async function forwardPlain(
  servers: readonly string[],
  query: Buffer,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
  port = 53,
): Promise<Buffer> {
  let lastError: Error = new Error("no fallback server");
  for (const server of servers) {
    try {
      const response = await forwardUdp(server, port, query, timeoutMs);
      const truncated = response.length >= 4 && (response.readUInt16BE(2) & 0x0200) !== 0;
      return truncated ? await forwardTcp(server, port, query, timeoutMs) : response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError;
}
