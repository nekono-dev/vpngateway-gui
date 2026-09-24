// 責務: 3proxyの設定ファイル文字列を組み立てる（純粋関数）。プロセス起動・監視は
// explicit-proxy-controller.tsが担い、本ファイルは「どの設定内容を書くか」のみを決める。
// proxyserver/design.md「明示的プロキシモードの実現方式」参照。

import { isIpv4Cidr } from "../lib/ipv4-cidr.js";

export interface ExplicitProxyConfigInput {
  // 許可元CIDR。1件以上・すべてIPv4 CIDR形式であること（違反時は例外）。
  allowedCidrs: readonly string[];
  socksPort: number;
  httpPort: number;
  // 名前解決に使うDNSサーバ（`127.0.0.1`または`127.0.0.1:5353`の形式）。DNS中継が有効なとき、3proxyの名前解決も
  // 中継リゾルバへ向けて迂回対象のsetへ登録させる。省略時は3proxy既定（コンテナのresolv.conf）を使う。
  nameServer?: string;
}

const NAME_SERVER_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(:\d{1,5})?$/;

/**
 * 目的: 許可元CIDRとポートから3proxy設定ファイルの内容を生成する。
 * 入力: input(許可元CIDR・SOCKS5ポート・HTTPポート)。
 * 出力: 3proxy設定ファイルの全文（末尾改行あり）。
 * 失敗時の方針: CIDRが空、いずれかがIPv4 CIDR形式でない、ポートが1〜65535の整数でない場合は例外を投げる。
 *              CIDRは設定ファイルの行へ埋め込むため、改行等による設定行の注入（許可範囲の意図しない拡大）を
 *              防ぐ目的で厳密に検証する（APIサーバでも検証済みだが、proxy側の最後の防波堤として再検証する）。
 * 例: buildExplicitProxyConfig({ allowedCidrs: ["192.168.3.0/24"], socksPort: 1080, httpPort: 3128 })
 */
export function buildExplicitProxyConfig(input: ExplicitProxyConfigInput): string {
  if (input.allowedCidrs.length === 0) {
    throw new Error("allowedCidrs must not be empty");
  }
  for (const cidr of input.allowedCidrs) {
    if (!isIpv4Cidr(cidr)) {
      throw new Error(`invalid CIDR: ${JSON.stringify(cidr)}`);
    }
  }
  for (const port of [input.socksPort, input.httpPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`invalid port: ${port}`);
    }
  }
  if (input.socksPort === input.httpPort) {
    throw new Error("socksPort and httpPort must differ");
  }
  if (input.nameServer !== undefined && !NAME_SERVER_PATTERN.test(input.nameServer)) {
    throw new Error(`invalid nameServer: ${JSON.stringify(input.nameServer)}`);
  }

  return [
    // 認証は送信元IPのみで判定する（許可CIDR外は拒否）。
    "auth iponly",
    ...(input.nameServer !== undefined ? [`nserver ${input.nameServer}`] : []),
    // 3proxyのACLは先頭から評価され最初の一致で確定する。許可CIDRを列挙し、それ以外は末尾のdenyで拒否する。
    // 同一ACLがこの後に定義する両サービス（socks/proxy）へ適用される。
    `allow * ${input.allowedCidrs.join(",")}`,
    "deny *",
    // 3proxyは自身ではルーティングを制御せず、OSの経路（VPN接続中はトンネル経由）に従って発信する。
    `socks -p${input.socksPort}`,
    `proxy -p${input.httpPort}`,
    "",
  ].join("\n");
}
