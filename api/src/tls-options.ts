// 責務: APIサーバ自身のHTTPS listen用サーバ証明書の読み込み（apiserver/design.md「APIサーバ自身のTLS」）。
// Webサーバ⇄APIサーバ間の通信路保護（specs/requirements.md「通信路の保護」）のためのサーバ証明書。
// ゲートウェイ制御チャネル（api/src/proxy-client/gateway-tls-options.ts）とは別経路・別CA（api-ca）。
// 証明書一式はinstall.shの`setup_gateway_pki`と同様の仕組みで/etc/vpngwgui/pki/へ配置される
// （単一ホスト構成はローカル生成、分離構成はオーケストレーターがscpで配布）。

import { readFileSync } from "node:fs";

const PKI_DIR = process.env.GATEWAY_PKI_DIR ?? "/etc/vpngwgui/pki";

export interface ApiServerTlsOptions {
  cert: Buffer;
  key: Buffer;
}

/**
 * 目的: APIサーバ自身のHTTPS listenに使うサーバ証明書・秘密鍵を、環境変数で指定されたファイルから読み込む。
 * 入力: なし（環境変数`API_TLS_CERT_FILE`・`API_TLS_KEY_FILE`。
 *      いずれも省略時は`$GATEWAY_PKI_DIR`配下の既定ファイル名（`api-server.crt`・`api-server.key`）を使う）。
 * 出力: Fastifyの`https`オプションへそのまま渡せる{ cert, key }。
 * 失敗時の方針: 証明書ファイルが読めない場合は例外を投げる（起動時に気づけるよう、無音のフォールバックはしない）。
 */
export function loadApiServerTlsOptions(): ApiServerTlsOptions {
  const certFile = process.env.API_TLS_CERT_FILE ?? `${PKI_DIR}/api-server.crt`;
  const keyFile = process.env.API_TLS_KEY_FILE ?? `${PKI_DIR}/api-server.key`;
  return {
    cert: readFileSync(certFile),
    key: readFileSync(keyFile),
  };
}
