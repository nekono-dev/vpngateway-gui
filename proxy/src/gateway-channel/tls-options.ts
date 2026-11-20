// 責務: Gateway UDS listener のTLS有効・無効を厳格に選び、mTLS server options を構築する。

import { readFileSync } from "node:fs";
import type { TlsOptions } from "node:tls";

export class GatewayTlsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayTlsConfigurationError";
  }
}

/**
 * 目的: strict flag に従いHTTPを選ぶか、証明書を検証するmTLS server optionsを構築する。
 * 出力: TLS OFF は undefined、TLS ON は明示CA・server cert/keyを使うTLS options。
 * 失敗時の方針: 不正値・必須path不足・読み込み失敗を起動エラーにし、HTTPへ降格しない。
 */
export function loadGatewayTlsOptions(env: NodeJS.ProcessEnv = process.env): TlsOptions | undefined {
  const enabled = env.GATEWAY_TLS_ENABLED ?? "false";
  if (enabled !== "true" && enabled !== "false") {
    throw new GatewayTlsConfigurationError("GATEWAY_TLS_ENABLED must be exactly true or false");
  }
  if (enabled === "false") return undefined;

  const caFile = env.GATEWAY_TLS_CA_FILE;
  const certFile = env.GATEWAY_TLS_CERT_FILE;
  const keyFile = env.GATEWAY_TLS_KEY_FILE;
  if (caFile === undefined || certFile === undefined || keyFile === undefined) {
    throw new GatewayTlsConfigurationError("GATEWAY_TLS_ENABLED=true requires CA, server certificate, and server key files");
  }
  try {
    return {
      ca: readFileSync(caFile),
      cert: readFileSync(certFile),
      key: readFileSync(keyFile),
      minVersion: "TLSv1.2",
      requestCert: true,
      rejectUnauthorized: true,
    };
  } catch (error) {
    throw new GatewayTlsConfigurationError(`Gateway TLS material could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
}
