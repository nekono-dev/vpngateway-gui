// 責務: 設定の動作検証のL3（この端末からの確認）の判定（純粋関数）。ブラウザが提出した出口IP、中継リゾルバでの検証名の
// 受信の記録から、項目の結果を決める（apiserver/design.md「設定の動作検証」の`client-egress`・`dns-redirect-path`の判定）。

import type { CheckNonceRecord } from "../proxy-client/proxy-client.js";

export interface CheckResult {
  status: "pass" | "fail" | "unconfirmed";
  expected?: string;
  observed?: string;
  hint?: string;
  reason?: string;
}

/**
 * 目的: この端末の出口IP（`client-egress`）を判定する。
 * 入力: browserIp(ブラウザが提出した出口IP。取得に失敗した場合はnull、提出が無ければundefined),
 *      tunnelIp(VPNトンネルの出口IP。得られなかった場合はundefined)。
 * 出力: 一致すれば合格、異なれば不合格。どちらかが得られなければ未確認。
 */
export function judgeClientEgress(browserIp: string | null | undefined, tunnelIp: string | undefined): CheckResult {
  if (browserIp === undefined) {
    return { status: "unconfirmed", reason: "この端末のブラウザから、結果が届きませんでした。", hint: "動作検証のタブを開いたまま、もう一度実行してください。" };
  }
  if (browserIp === null) {
    return {
      status: "unconfirmed",
      reason: "この端末から、IP確認サービスに接続できませんでした。",
      hint: "IP確認サービスのURLが、ブラウザからの接続を許可し（CORS）、IPv4アドレスのみを返すサービスか確認してください。",
    };
  }
  if (tunnelIp === undefined) {
    return { status: "unconfirmed", reason: "VPNトンネルの出口IPが得られなかったため、比較できません（「VPN トンネルの出口 IP」を参照）。" };
  }
  if (browserIp === tunnelIp) return { status: "pass", observed: `${browserIp}（VPN の出口と一致）` };
  return {
    status: "fail",
    expected: `この端末の出口IPが、VPNの出口（${tunnelIp}）と一致する`,
    observed: browserIp,
    hint: "この端末の通信が、ゲートウェイ（VPN）を経由していません。端末のデフォルトゲートウェイがこのゲートウェイか、LAN外（VPN等）から開いていないかを確認してください。",
  };
}

/**
 * 目的: 53番リダイレクトの通過（`dns-redirect-path`）を判定する。
 * 入力: record(中継リゾルバでの検証名の受信の記録。取得できなければundefined)。
 * 出力: この端末の問い合わせが誘導された、または直近10分に誘導の実績があれば合格。端末側の事情で判定できない場合は未確認
 *      （リダイレクトの故障と端末側の事情をブラウザからは区別できないため、不合格にはしない。構成の故障は`dns-redirect-rules`が検出する）。
 */
export function judgeDnsRedirect(record: CheckNonceRecord | undefined): CheckResult {
  if (record === undefined) {
    return { status: "unconfirmed", reason: "検証用の名前の受信記録を取得できませんでした。" };
  }
  if (record.received && record.redirected) {
    return { status: "pass", observed: "この端末の問い合わせが、中継リゾルバへ誘導されたことを確認" };
  }
  if (record.recentRedirectedClients > 0) {
    const thisClient = record.received ? "ゲートウェイへ直接届いた" : "届かなかった";
    return {
      status: "pass",
      observed: `直近10分に ${record.recentRedirectedClients} 台の端末の問い合わせを誘導した実績あり（この端末の問い合わせは${thisClient}）`,
    };
  }
  if (record.received) {
    return {
      status: "unconfirmed",
      reason: "この端末はゲートウェイをDNSサーバとして直接使っているため、リダイレクトを通りません（中継リゾルバへの到達は確認できました）。",
    };
  }
  return {
    status: "unconfirmed",
    reason: "この端末の問い合わせは、中継リゾルバへ届きませんでした。",
    hint: "この端末が暗号化DNS（DoH・DoT・プライベートDNS）を使っていないか、DNSサーバがリダイレクトの除外先になっていないかを確認してください。",
  };
}
