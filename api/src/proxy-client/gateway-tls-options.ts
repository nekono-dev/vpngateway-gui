// 責務: ゲートウェイ制御チャネル（APIサーバ⇄proxy、mTLS TCP）のクライアント証明書読み込み。
// apiserver/design.md「内部プロトコルの変更」: undiciのAgent({ connect: { ca, cert, key } })へ渡す。
// 証明書一式はinstall.shの`setup_gateway_pki`が/etc/vpngwgui/pki/へローカル生成する
// （単一ホスト構成向け。分離構成でのSCP配布はStage3で対応）。

import { readFileSync } from "node:fs";

const PKI_DIR = process.env.GATEWAY_PKI_DIR ?? "/etc/vpngwgui/pki";

export interface GatewayClientTlsOptions {
  ca: Buffer;
  cert: Buffer;
  key: Buffer;
}

/**
 * 目的: ゲートウェイ制御チャネルへのmTLSクライアント証明書一式を、環境変数で指定されたファイルから読み込む。
 * 入力: なし（環境変数`GATEWAY_TLS_CA_FILE`・`GATEWAY_TLS_CERT_FILE`・`GATEWAY_TLS_KEY_FILE`。
 *      いずれも省略時は`$GATEWAY_PKI_DIR`配下の既定ファイル名を使う）。
 * 出力: undiciの`Agent({ connect: {...} })`へそのまま渡せる{ ca, cert, key }。
 * 失敗時の方針: 証明書ファイルが読めない場合は例外を投げる（起動時に気づけるよう、無音のフォールバックはしない）。
 */
export function loadGatewayClientTlsOptions(): GatewayClientTlsOptions {
  const caFile = process.env.GATEWAY_TLS_CA_FILE ?? `${PKI_DIR}/gateway-ca.crt`;
  const certFile = process.env.GATEWAY_TLS_CERT_FILE ?? `${PKI_DIR}/api-client.crt`;
  const keyFile = process.env.GATEWAY_TLS_KEY_FILE ?? `${PKI_DIR}/api-client.key`;
  return {
    ca: readFileSync(caFile),
    cert: readFileSync(certFile),
    key: readFileSync(keyFile),
  };
}
