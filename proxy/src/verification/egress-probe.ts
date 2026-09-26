// 責務: 設定の動作検証のL2で、IP確認サービス（応答本文がIPv4アドレスのみのサービス）から出口IPを取得する。
// 経路（VPNトンネルのインターフェースへの束縛、明示的プロキシ経由）を指定して`curl`を実行する
// （proxyserver/design.md「設定の動作検証」の「L2の通信」）。

import { spawn } from "node:child_process";

const CURL_BIN = process.env.CURL_BIN ?? "curl";
const MAX_TIME_SECONDS = 8;
const MAX_BODY_LENGTH = 1024;
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// 取得の経路。interface: 指定インターフェースへ束縛する / proxy: 明示的プロキシ（`socks5h://`・`http://`）を経由する。
export type EgressRoute = { interface: string } | { proxy: string };

export type EgressResult = { ok: true; ip: string } | { ok: false; error: string };

/**
 * 目的: IP確認サービスの応答本文から、IPv4アドレスを取り出す。
 * 入力: body(応答本文)。
 * 出力: 前後の空白・改行を除いた本文がIPv4アドレスならその値、そうでなければundefined。
 * 例: parseEgressBody("203.0.113.24\n") // => "203.0.113.24"
 */
export function parseEgressBody(body: string): string | undefined {
  const trimmed = body.trim();
  const match = IPV4_PATTERN.exec(trimmed);
  if (match === null || match.slice(1).some((octet) => Number(octet) > 255)) return undefined;
  return trimmed;
}

/**
 * 目的: curlの引数を組み立てる（テスト用に分離）。
 * 入力: url(IP確認サービスのURL。https), route(経路)。
 * 出力: curlへの引数。IPv4に限定し、タイムアウトを付ける。
 */
export function buildCurlArgs(url: string, route: EgressRoute): string[] {
  const via = "interface" in route ? ["--interface", route.interface] : ["--proxy", route.proxy];
  return ["-sS", "-4", "--max-time", String(MAX_TIME_SECONDS), ...via, "--", url];
}

/**
 * 目的: 経路を指定して、IP確認サービスから出口IPを取得する。
 * 入力: url(IP確認サービスのURL), route(経路)。
 * 出力: 取得できればIPv4アドレス。接続失敗・タイムアウト・本文がIPv4でない場合はエラーの説明。
 * 失敗時の方針: 例外は投げない。
 */
export function fetchEgressIp(url: string, route: EgressRoute): Promise<EgressResult> {
  return new Promise((resolve) => {
    const child = spawn(CURL_BIN, buildCurlArgs(url, route), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_BODY_LENGTH) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => resolve({ ok: false, error: `curlを実行できない（${error.message}）` }));
    child.on("exit", (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: stderr.trim().split("\n")[0] || `curlが失敗（終了コード${code}）` });
        return;
      }
      const ip = parseEgressBody(stdout);
      resolve(ip === undefined ? { ok: false, error: "応答本文がIPv4アドレスではない" } : { ok: true, ip });
    });
  });
}
