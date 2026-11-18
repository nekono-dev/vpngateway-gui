// 責務: Gateway UDS transport の環境設定を読み込み、HTTP または検証必須の mTLS 接続設定を組み立てる。

import { readFileSync } from "node:fs";
import { X509Certificate, createPrivateKey } from "node:crypto";
import type { Agent } from "undici";

export interface GatewayTransportOptions {
  origin: string;
  socketPath: string;
  connect: Agent.Options["connect"];
}

export class GatewayTlsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayTlsConfigurationError";
  }
}

/** 現在時刻が証明書の有効期間内であることを確認する。 */
export function assertCertificateValidity(certificate: X509Certificate, now = Date.now()): void {
  if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) {
    throw new GatewayTlsConfigurationError("Gateway client certificate is outside its validity period");
  }
}

/** 設定値を厳密に読み、TLS 設定不備を平文へ降格させずに拒否する。 */
export function loadGatewayTransportOptions(env: NodeJS.ProcessEnv = process.env): GatewayTransportOptions {
  const enabledValue = env.GATEWAY_TLS_ENABLED ?? "false";
  if (enabledValue !== "true" && enabledValue !== "false") {
    throw new GatewayTlsConfigurationError("GATEWAY_TLS_ENABLED must be exactly true or false");
  }
  const socketPath = env.GATEWAY_SOCKET_PATH ?? "/run/vpngw-gateway/gateway.sock";
  if (enabledValue === "false") return { origin: "http://gateway", socketPath, connect: { socketPath } };

  const caFile = env.GATEWAY_TLS_CA_FILE;
  const certFile = env.GATEWAY_TLS_CLIENT_CERT_FILE;
  const keyFile = env.GATEWAY_TLS_CLIENT_KEY_FILE;
  if (!caFile || !certFile || !keyFile) {
    throw new GatewayTlsConfigurationError("Gateway TLS requires CA, client certificate, and client key files");
  }
  try {
    const ca = readFileSync(caFile);
    const cert = readFileSync(certFile);
    const key = readFileSync(keyFile);
    const clientCertificate = new X509Certificate(cert);
    const privateKey = createPrivateKey(key);
    assertCertificateValidity(clientCertificate);
    if (!clientCertificate.checkPrivateKey(privateKey)) {
      throw new GatewayTlsConfigurationError("Gateway client certificate and private key do not match");
    }
    const servername = env.GATEWAY_TLS_SERVER_NAME ?? "gateway.local";
    return {
      origin: `https://${servername}`,
      socketPath,
      connect: { socketPath, ca, cert, key, servername, rejectUnauthorized: true, minVersion: "TLSv1.2" },
    };
  } catch (error) {
    if (error instanceof GatewayTlsConfigurationError) throw error;
    throw new GatewayTlsConfigurationError(`Gateway TLS material is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}
