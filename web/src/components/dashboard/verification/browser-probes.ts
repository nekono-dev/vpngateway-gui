// 責務: 設定の動作検証のL3で、ブラウザ自身が行う観測（IP確認サービスからの出口IPの取得、検証用の名前の解決）。
// 利用者の操作を求めず、検証の開始直後に行う（webserver/design.md「設定の動作検証の実装方針」の「ブラウザ側の観測（L3）」）。

const EGRESS_TIMEOUT_MS = 8000;
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * 目的: IP確認サービスから、この端末の出口IP（IPv4）を取得する。
 * 入力: url(IP確認サービスのURL。応答本文がIPv4アドレスのみのテキストであること)。
 * 出力: IPv4アドレス。接続できない（CORSの拒否・タイムアウト等）、本文がIPv4でない場合はnull。
 */
export async function fetchBrowserEgressIp(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EGRESS_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.text()).trim();
    const match = IPV4_PATTERN.exec(body);
    return match !== null && match.slice(1).every((octet) => Number(octet) <= 255) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 目的: 検証用の名前をブラウザに名前解決させる（端末のDNS設定に従った問い合わせを起こす）。応答・成否は使わない
 *      （名前は存在しないため、失敗するのが正常）。Web UIがHTTPSで配信される場合の混在コンテンツの遮断を避けるため`https`にする。
 * 入力: name(検証用の名前)。
 */
export function triggerDnsLookup(name: string): void {
  fetch(`https://${name}/`, { mode: "no-cors", cache: "no-store" }).catch(() => undefined);
}
