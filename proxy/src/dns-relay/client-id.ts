// 責務: 上流のDNSサーバ（自宅のDNSサーバ）がクライアントを識別するためのClientIDを、LANクライアントのIP/MACから生成する。
// ClientIDの制約（小文字英数字とハイフン、63文字以内）に合わせる。proxyserver/design.md「DNS中継リゾルバ」のClientID参照。

import { readFileSync } from "node:fs";

// ゲートウェイ自身（3proxyからの問い合わせ）を表す固定のClientID。
export const LOCAL_CLIENT_ID = "explicit-proxy";
const MAC_PATTERN = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
const CACHE_TTL_MS = 30_000;

/**
 * 目的: `/proc/net/arp`の内容から、IPv4アドレス→MACアドレスの対応を取り出す。
 * 入力: text(`/proc/net/arp`の内容)。
 * 出力: IP→MAC（小文字）のMap。完了していないエントリ（00:00:00:00:00:00）や不正な行は含めない。
 */
export function parseArpTable(text: string): Map<string, string> {
  const table = new Map<string, string>();
  for (const line of text.split("\n").slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 4) continue;
    const [ip, , flags, mac] = columns;
    const normalized = mac.toLowerCase();
    if (!MAC_PATTERN.test(normalized) || normalized === "00:00:00:00:00:00") continue;
    if (flags === "0x0") continue;
    table.set(ip, normalized);
  }
  return table;
}

/**
 * 目的: クライアントのMAC（あれば）またはIPからClientIDを作る。
 * 入力: clientIp(IPv4アドレス), mac(コロン区切りの小文字MAC。不明ならundefined)。
 * 出力: `mac-aa-bb-cc-dd-ee-ff`、またはMACが無ければ`ip-192-168-3-25`。IPが不正な形式なら固定のフォールバック`unknown-client`。
 */
export function buildClientId(clientIp: string, mac: string | undefined): string {
  if (mac !== undefined && MAC_PATTERN.test(mac)) {
    return `mac-${mac.replaceAll(":", "-")}`;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clientIp)) {
    return `ip-${clientIp.replaceAll(".", "-")}`;
  }
  return "unknown-client";
}

/**
 * 目的: クライアントIPからClientIDを引く。ARPテーブルの読み取りを一定時間キャッシュする。
 */
export class ClientIdResolver {
  private table = new Map<string, string>();
  private loadedAt = Number.NEGATIVE_INFINITY;

  /**
   * 入力: readArp(`/proc/net/arp`の内容を返す関数。テスト用フック), now(現在時刻ms。テスト用フック),
   *      localAddresses(ゲートウェイ自身のアドレス。これらからの問い合わせは固定IDにする)。
   */
  constructor(
    private readonly localAddresses: readonly string[] = ["127.0.0.1"],
    private readonly readArp: () => string = () => readFileSync("/proc/net/arp", "utf8"),
    private readonly now: () => number = Date.now,
  ) {}

  resolve(clientIp: string): string {
    if (this.localAddresses.includes(clientIp)) return LOCAL_CLIENT_ID;
    return buildClientId(clientIp, this.lookupMac(clientIp));
  }

  private lookupMac(clientIp: string): string | undefined {
    // 期限切れ、または未知のIP（新規端末の初回問い合わせ）のときに読み直す。
    if (this.now() - this.loadedAt > CACHE_TTL_MS || !this.table.has(clientIp)) {
      try {
        this.table = parseArpTable(this.readArp());
      } catch {
        this.table = new Map();
      }
      this.loadedAt = this.now();
    }
    return this.table.get(clientIp);
  }
}
