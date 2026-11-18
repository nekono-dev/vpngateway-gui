// 責務: Web HTTPS の strict 設定と証明書・鍵の読込、鍵ペア検証および API CA の読込。

import { readFileSync } from "node:fs";
import { createSecureContext } from "node:tls";

const PKI_DIR = process.env.GATEWAY_PKI_DIR ?? "/etc/vpngwgui/pki";

export interface WebServerTlsOptions {
  cert: Buffer;
  key: Buffer;
}

type Environment = NodeJS.ProcessEnv;
type FileReader = (path: string) => Buffer;
type TlsPairValidator = (options: WebServerTlsOptions) => unknown;

/** Web HTTPS の strict boolean を読み、true の場合だけ有効な TLS 設定を返す。 */
export function loadWebServerHttpsOptions(
  env: Environment = process.env,
  readFile: FileReader = (path) => readFileSync(path),
  validatePair: TlsPairValidator = (options) => createSecureContext(options),
): WebServerTlsOptions | undefined {
  const enabled = env.WEB_HTTPS_ENABLED;
  if (enabled === undefined || enabled === "false") return undefined;
  if (enabled !== "true") {
    throw new Error('WEB_HTTPS_ENABLED must be exactly "true" or "false"');
  }

  const certFile = env.WEB_TLS_CERT_FILE;
  const keyFile = env.WEB_TLS_KEY_FILE;
  if (!certFile || !keyFile) {
    throw new Error("WEB_TLS_CERT_FILE and WEB_TLS_KEY_FILE are required when WEB_HTTPS_ENABLED=true");
  }

  const options = { cert: readFile(certFile), key: readFile(keyFile) };
  validatePair(options);
  return options;
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
