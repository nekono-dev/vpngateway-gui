// 責務: Web HTTPS の strict 設定と証明書・鍵の読込および鍵ペア検証。

import { readFileSync } from "node:fs";
import { createSecureContext } from "node:tls";

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
