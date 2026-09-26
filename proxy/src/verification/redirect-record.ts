// 責務: 53番リダイレクトで誘導した送信元の記録（nftのset`redirected4`）から、「直前に誘導された」かを判定する純粋関数。
// ルールは誘導のたびに`update`で要素の期限を`REDIRECTED_RECORD_SECONDS`へ戻すため、残り期限がほぼ満了前のままなら、
// 直前（数秒以内）に誘導された問い合わせがあったと判断できる（proxyserver/design.md「53番リダイレクトで誘導した送信元の記録」）。

import { REDIRECTED_RECORD_SECONDS } from "../network/ruleset.js";
import type { SetElement } from "./nft-listing.js";

// 誘導（期限の更新）から、中継リゾルバが受信して判定するまでに見込む時間（秒）。
const RECENT_WINDOW_SECONDS = 5;

/**
 * 目的: 送信元の問い合わせが、直前に53番リダイレクトで誘導されたかを判定する。
 * 入力: elements(`redirected4`の要素), clientIp(問い合わせの送信元)。
 * 出力: 送信元の要素があり、残り期限が`REDIRECTED_RECORD_SECONDS - 5`秒以上ならtrue。
 * 例: wasJustRedirected([{ address: "192.168.3.20", expiresSeconds: 599 }], "192.168.3.20") // => true
 */
export function wasJustRedirected(elements: readonly SetElement[], clientIp: string): boolean {
  const element = elements.find((candidate) => candidate.address === clientIp);
  return element?.expiresSeconds !== undefined && element.expiresSeconds >= REDIRECTED_RECORD_SECONDS - RECENT_WINDOW_SECONDS;
}
