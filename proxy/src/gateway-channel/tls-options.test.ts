// 責務: ゲートウェイ制御チャネルのmTLS（loadGatewayTlsOptions）の単体・結合テスト。
// クライアント証明書が無い・不正なCAで署名された接続は確立されず、正しいクライアント証明書
// （gateway-caで署名）を持つ接続のみ確立されることを、実際にTLSサーバ・クライアントで検証する。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createHttpsServer, request as httpsRequest, type Server } from "node:https";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-gateway-tls-"));

/** 目的: opensslでCAと、それが署名したリーフ証明書（サーバ or クライアント）を1組作る。 */
function issueCert(caKeyPath: string, caCertPath: string, name: string): { certPath: string; keyPath: string } {
  const keyPath = join(dir, `${name}.key`);
  const csrPath = join(dir, `${name}.csr`);
  const certPath = join(dir, `${name}.crt`);
  execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", csrPath, "-subj", `/CN=${name}`]);
  execFileSync("openssl", ["x509", "-req", "-in", csrPath, "-CA", caCertPath, "-CAkey", caKeyPath, "-CAcreateserial", "-days", "1", "-out", certPath]);
  return { certPath, keyPath };
}

let caCertPath: string;
let otherCaCertPath: string;
let serverCertPath: string;
let serverKeyPath: string;
let validClientCertPath: string;
let validClientKeyPath: string;
let untrustedClientCertPath: string;
let untrustedClientKeyPath: string;

beforeAll(() => {
  // gateway-ca（正規のCA）
  const caKeyPath = join(dir, "gateway-ca.key");
  caCertPath = join(dir, "gateway-ca.crt");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", caKeyPath, "-out", caCertPath, "-subj", "/CN=gateway-ca"]);

  // SAN検証はこのテストの対象外（127.0.0.1直結・rejectUnauthorized:falseで確認するため、CNのみで足りる）。
  const server = issueCert(caKeyPath, caCertPath, "proxy-server");
  serverCertPath = server.certPath;
  serverKeyPath = server.keyPath;

  const client = issueCert(caKeyPath, caCertPath, "api-client");
  validClientCertPath = client.certPath;
  validClientKeyPath = client.keyPath;

  // 別のCA（正規のgateway-caとは無関係）で署名した、なりすましクライアント証明書。
  const otherCaKeyPath = join(dir, "other-ca.key");
  otherCaCertPath = join(dir, "other-ca.crt");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", otherCaKeyPath, "-out", otherCaCertPath, "-subj", "/CN=other-ca"]);
  const untrusted = issueCert(otherCaKeyPath, otherCaCertPath, "untrusted-client");
  untrustedClientCertPath = untrusted.certPath;
  untrustedClientKeyPath = untrusted.keyPath;
});

describe("loadGatewayTlsOptions", () => {
  it("環境変数で指定したca/cert/keyを読み込み、requestCert・rejectUnauthorizedをtrueにする", async () => {
    process.env.GATEWAY_TLS_CA_FILE = caCertPath;
    process.env.GATEWAY_TLS_CERT_FILE = serverCertPath;
    process.env.GATEWAY_TLS_KEY_FILE = serverKeyPath;
    const { loadGatewayTlsOptions } = await import("./tls-options.js");
    const options = loadGatewayTlsOptions();
    expect(options.requestCert).toBe(true);
    expect(options.rejectUnauthorized).toBe(true);
    expect((options.cert as Buffer).toString()).toBe(readFileSync(serverCertPath, "utf8"));
  });
});

describe("mTLSサーバ（loadGatewayTlsOptionsで構築）", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    process.env.GATEWAY_TLS_CA_FILE = caCertPath;
    process.env.GATEWAY_TLS_CERT_FILE = serverCertPath;
    process.env.GATEWAY_TLS_KEY_FILE = serverKeyPath;
    const { loadGatewayTlsOptions } = await import("./tls-options.js");
    server = createHttpsServer(loadGatewayTlsOptions(), (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
    delete process.env.GATEWAY_TLS_CA_FILE;
    delete process.env.GATEWAY_TLS_CERT_FILE;
    delete process.env.GATEWAY_TLS_KEY_FILE;
  });

  /** 指定したクライアント証明書（省略可）で接続し、成功すればステータス、失敗すればエラーで解決する。 */
  function connect(clientCert?: { cert: string; key: string }): Promise<{ status: number } | { error: true }> {
    return new Promise((resolve) => {
      const req = httpsRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/net/status",
          method: "GET",
          ca: readFileSync(caCertPath),
          cert: clientCert ? readFileSync(clientCert.cert) : undefined,
          key: clientCert ? readFileSync(clientCert.key) : undefined,
          rejectUnauthorized: false, // サーバ証明書のホスト名検証はこのテストの対象外（127.0.0.1直結のため）。
          timeout: 3000,
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0 });
        },
      );
      req.on("error", () => resolve({ error: true }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ error: true });
      });
      req.end();
    });
  }

  it("クライアント証明書無しの接続は拒否される（完了基準: GATEWAY_PORTへクライアント証明書無しで接続すると拒否）", async () => {
    const result = await connect();
    expect(result).toEqual({ error: true });
  });

  it("別のCAで署名されたクライアント証明書は拒否される", async () => {
    const result = await connect({ cert: untrustedClientCertPath, key: untrustedClientKeyPath });
    expect(result).toEqual({ error: true });
  });

  it("gateway-caで署名した正しいクライアント証明書は接続でき、応答を受け取れる", async () => {
    const result = await connect({ cert: validClientCertPath, key: validClientKeyPath });
    expect(result).toEqual({ status: 200 });
  });
});
