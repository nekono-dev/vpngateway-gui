// 責務: ゲートウェイ制御チャネル（APIサーバ⇄proxy、mTLS TCP）のTLSサーバオプションの組み立て。
// proxyserver/design.md「ゲートウェイ制御チャネル」: サーバ証明書はgateway-caが署名したもの、
// クライアント証明書の検証（requestCert: true・rejectUnauthorized: true）でAPIサーバを認証する。
// 証明書一式はinstall.shの`setup_gateway_pki`が/etc/vpngwgui/pki/へローカル生成する
// （単一ホスト構成向け。分離構成でのSCP配布はStage3で対応）。

import { readFileSync } from "node:fs";
import type { TlsOptions } from "node:tls";

const PKI_DIR = process.env.GATEWAY_PKI_DIR ?? "/etc/vpngwgui/pki";

/**
 * 目的: ゲートウェイ制御チャネルのmTLSサーバオプションを、環境変数で指定された証明書ファイルから組み立てる。
 * 入力: なし（環境変数`GATEWAY_TLS_CA_FILE`・`GATEWAY_TLS_CERT_FILE`・`GATEWAY_TLS_KEY_FILE`。
 *      いずれも省略時は`$GATEWAY_PKI_DIR`配下の既定ファイル名を使う）。
 * 出力: `https.createServer`へ渡すTLSオプション（`requestCert: true`・`rejectUnauthorized: true`で、
 *      `ca`で指定した認証局（gateway-ca）が発行したクライアント証明書を要求・検証する）。
 * 失敗時の方針: 証明書ファイルが読めない場合は例外を投げる（起動時に気づけるよう、無音のフォールバックはしない）。
 */
export function loadGatewayTlsOptions(): TlsOptions {
  const caFile = process.env.GATEWAY_TLS_CA_FILE ?? `${PKI_DIR}/gateway-ca.crt`;
  const certFile = process.env.GATEWAY_TLS_CERT_FILE ?? `${PKI_DIR}/proxy-server.crt`;
  const keyFile = process.env.GATEWAY_TLS_KEY_FILE ?? `${PKI_DIR}/proxy-server.key`;
  return {
    ca: readFileSync(caFile),
    cert: readFileSync(certFile),
    key: readFileSync(keyFile),
    requestCert: true,
    rejectUnauthorized: true,
  };
}
