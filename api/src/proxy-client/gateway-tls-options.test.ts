// 責務: Gateway UDS transport の既定値・厳密な TLS 切替・TLS 設定不足時の fail-closed を検証する。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { assertCertificateValidity, GatewayTlsConfigurationError, loadGatewayTransportOptions } from "./gateway-tls-options.js";

const certificateDirectory = join(import.meta.dirname, "../../../web/server/testdata");
const certificatePath = join(certificateDirectory, "web-test.crt");

describe("loadGatewayTransportOptions", () => {
  it("TLS 既定 OFF では標準 socket 上の HTTP を選ぶ", () => {
    expect(loadGatewayTransportOptions({} as NodeJS.ProcessEnv)).toEqual({
      origin: "http://gateway",
      socketPath: "/run/vpngw-gateway/gateway.sock",
      connect: { socketPath: "/run/vpngw-gateway/gateway.sock" },
    });
  });

  it("socket path を環境変数で変更できる", () => {
    const config = loadGatewayTransportOptions({ GATEWAY_SOCKET_PATH: "/tmp/gateway.sock" } as NodeJS.ProcessEnv);
    expect(config.socketPath).toBe("/tmp/gateway.sock");
    expect(config.connect).toEqual({ socketPath: "/tmp/gateway.sock" });
  });

  it("boolean の表記揺れや TLS material 不足を拒否し、平文へ降格しない", () => {
    expect(() => loadGatewayTransportOptions({ GATEWAY_TLS_ENABLED: "yes" } as NodeJS.ProcessEnv)).toThrow(GatewayTlsConfigurationError);
    expect(() => loadGatewayTransportOptions({ GATEWAY_TLS_ENABLED: "true" } as NodeJS.ProcessEnv)).toThrow(/requires CA/);
  });

  it("TLS ON では設計名の client cert/key と CA を設定し、SAN 名で検証する", () => {
    const config = loadGatewayTransportOptions({
      GATEWAY_TLS_ENABLED: "true",
      GATEWAY_SOCKET_PATH: "/tmp/gateway.sock",
      GATEWAY_TLS_CA_FILE: certificatePath,
      GATEWAY_TLS_CLIENT_CERT_FILE: certificatePath,
      GATEWAY_TLS_CLIENT_KEY_FILE: join(certificateDirectory, "web-test.key"),
      GATEWAY_TLS_SERVER_NAME: "localhost",
    } as NodeJS.ProcessEnv);
    expect(config.origin).toBe("https://localhost");
    expect(config.connect).toMatchObject({
      socketPath: "/tmp/gateway.sock",
      servername: "localhost",
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ca: expect.any(Buffer),
      cert: expect.any(Buffer),
      key: expect.any(Buffer),
    });
  });

  it("不一致の client key を拒否し、証明書の期限切れを検出する", () => {
    expect(() => loadGatewayTransportOptions({
      GATEWAY_TLS_ENABLED: "true",
      GATEWAY_TLS_CA_FILE: certificatePath,
      GATEWAY_TLS_CLIENT_CERT_FILE: certificatePath,
      GATEWAY_TLS_CLIENT_KEY_FILE: join(certificateDirectory, "other-test.key"),
    } as NodeJS.ProcessEnv)).toThrow(GatewayTlsConfigurationError);
    const certificate = new X509Certificate(readFileSync(certificatePath));
    expect(() => assertCertificateValidity(certificate, Date.parse("2127-01-01T00:00:00Z"))).toThrow(/outside its validity period/);
  });
});
