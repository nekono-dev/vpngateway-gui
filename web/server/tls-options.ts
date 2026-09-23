// 責務: Webサーバ自身のHTTPS listen用サーバ証明書と、APIサーバへのプロキシ時に検証するCA証明書の読み込み。
// webserver/design.md「ブラウザ⇄Webサーバ」「TLS検証」: ブラウザ⇄webは自己署名サーバ証明書による片方向TLS、
// web⇄api間は`api-ca`でAPIサーバのサーバ証明書を検証する（rejectUnauthorizedを無効化しない）。
// 証明書一式はinstall.shが/etc/vpngwgui/pki/へ配置する（単一ホスト構成はローカル生成、分離構成は
// オーケストレーターがscpで配布する）。

import { readFileSync } from "node:fs";

const PKI_DIR = process.env.GATEWAY_PKI_DIR ?? "/etc/vpngwgui/pki";

export interface WebServerTlsOptions {
  cert: Buffer;
  key: Buffer;
}

/**
 * 目的: Webサーバ自身のHTTPS listenに使うサーバ証明書・秘密鍵を、環境変数で指定されたファイルから読み込む。
 * 入力: なし（環境変数`WEB_TLS_CERT_FILE`・`WEB_TLS_KEY_FILE`。
 *      いずれも省略時は`$GATEWAY_PKI_DIR`配下の既定ファイル名（`web-server.crt`・`web-server.key`）を使う）。
 * 出力: Fastifyの`https`オプションへそのまま渡せる{ cert, key }。
 * 失敗時の方針: 証明書ファイルが読めない場合は例外を投げる（起動時に気づけるよう、無音のフォールバックはしない）。
 */
export function loadWebServerTlsOptions(): WebServerTlsOptions {
  const certFile = process.env.WEB_TLS_CERT_FILE ?? `${PKI_DIR}/web-server.crt`;
  const keyFile = process.env.WEB_TLS_KEY_FILE ?? `${PKI_DIR}/web-server.key`;
  return {
    cert: readFileSync(certFile),
    key: readFileSync(keyFile),
  };
}

/**
 * 目的: `/api/*`をAPIサーバへプロキシする際、APIサーバのサーバ証明書を検証するためのCA証明書を読み込む。
 * 入力: なし（環境変数`API_TLS_CA_FILE`。省略時は`$GATEWAY_PKI_DIR`配下の既定ファイル名`api-ca.crt`を使う）。
 * 出力: `@fastify/http-proxy`の`agentOptions.ca`へそのまま渡せるBuffer。
 * 失敗時の方針: 証明書ファイルが読めない場合は例外を投げる（無音のフォールバック・検証省略は行わない）。
 */
export function loadApiCaCertificate(): Buffer {
  const caFile = process.env.API_TLS_CA_FILE ?? `${PKI_DIR}/api-ca.crt`;
  return readFileSync(caFile);
}
