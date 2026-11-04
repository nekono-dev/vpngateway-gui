// 責務: 開発サーバの公開 IP を取得する。接続前の出口 IP の基準として使う（要件 1.11）。
// 取得先は、検証サーバの既定の verifyEchoUrl と同じ IP 確認サービス。

import { request } from "node:https";

/** 検証サーバの既定の verifyEchoUrl と同じ（api/src/settings/settings-store.ts）。 */
export const PUBLIC_IP_URL = "https://api.ipify.org";

/**
 * 目的: IP 確認サービスの本文から、IPv4 の書式の文字列だけを取り出す。
 * 入力: body(応答の本文。前後の空白・改行は許容する)。
 * 出力: IPv4 の文字列（各オクテット 0〜255）。書式が合わなければ null。
 * 例: parsePublicIp("156.146.34.246\n") // => "156.146.34.246" / parsePublicIp("<html>") // => null
 */
export function parsePublicIp(body: string): string | null {
  const candidate = body.trim();
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(candidate);
  if (match === null) return null;
  const octets = match.slice(1, 5).map((octet) => Number(octet));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? candidate : null;
}

/**
 * 目的: 開発サーバの既定経路から IP 確認サービスへ要求し、公開 IP を得る。
 * 入力: url（既定は PUBLIC_IP_URL）、timeoutMs（既定 10 秒）。
 * 出力: IPv4 の文字列。
 * 失敗時の方針: 通信の失敗・書式の不一致は、理由を含む例外を投げる（基準の無いまま試験へ進まない）。
 * 例: const ip = await fetchPublicIp(); // => "156.146.34.246"
 */
export function fetchPublicIp(url: string = PUBLIC_IP_URL, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers: { accept: "text/plain" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const ip = parsePublicIp(Buffer.concat(chunks).toString("utf8"));
        if (ip === null) {
          reject(new Error("public-ip-unavailable: IP 確認サービスの応答が IPv4 の書式ではない"));
          return;
        }
        resolve(ip);
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`public-ip-unavailable: タイムアウト（${timeoutMs} ms）`));
    });
    req.on("error", (err: Error) => {
      reject(new Error(err.message.startsWith("public-ip-unavailable") ? err.message : `public-ip-unavailable: ${err.message}`));
    });
    req.end();
  });
}
