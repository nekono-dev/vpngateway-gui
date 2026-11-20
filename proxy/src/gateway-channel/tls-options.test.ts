// 責務: ゲートウェイ制御チャネルのmTLS（loadGatewayTlsOptions）の単体・結合テスト。
// クライアント証明書が無い・不正なCAで署名された接続は確立されず、正しいクライアント証明書
// （gateway-caで署名）を持つ接続のみ確立されることを、実際にTLSサーバ・クライアントで検証する。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request as httpsRequest } from "node:https";
import { request as httpRequest, type Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createGatewayChannelServer } from "./control-server.js";
import { listenOnGatewaySocket } from "./server.js";

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
  it("TLS無効時は証明書を参照せずHTTP設定を選ぶ", async () => {
    const { loadGatewayTlsOptions } = await import("./tls-options.js");
    expect(loadGatewayTlsOptions({ GATEWAY_TLS_ENABLED: "false" })).toBeUndefined();
  });

  it("TLS有効時は明示したCA/cert/keyと必須client認証を設定する", async () => {
    const { loadGatewayTlsOptions } = await import("./tls-options.js");
    const options = loadGatewayTlsOptions({
      GATEWAY_TLS_ENABLED: "true",
      GATEWAY_TLS_CA_FILE: caCertPath,
      GATEWAY_TLS_CERT_FILE: serverCertPath,
      GATEWAY_TLS_KEY_FILE: serverKeyPath,
    });
    if (options === undefined) throw new Error("TLS options must exist when TLS is enabled");
    expect(options.requestCert).toBe(true);
    expect(options.rejectUnauthorized).toBe(true);
    expect((options.cert as Buffer).toString()).toBe(readFileSync(serverCertPath, "utf8"));
  });

  it.each(["yes", "TRUE", "", "0"])("TLS flag %j を拒否する", async (value) => {
    const { loadGatewayTlsOptions } = await import("./tls-options.js");
    expect(() => loadGatewayTlsOptions({ GATEWAY_TLS_ENABLED: value })).toThrow(/exactly true or false/);
  });

  it("TLS有効時に証明書設定が不足すると起動用設定の読込に失敗する", async () => {
    const { loadGatewayTlsOptions } = await import("./tls-options.js");
    expect(() => loadGatewayTlsOptions({ GATEWAY_TLS_ENABLED: "true" })).toThrow(/requires CA/);
  });
});

describe("mTLSサーバ（loadGatewayTlsOptionsで構築）", () => {
  let server: Server;
  let listener: Awaited<ReturnType<typeof listenOnGatewaySocket>>;
  const socketPath = join(dir, "gateway-tls.sock");

  beforeAll(async () => {
    server = createGatewayChannelServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    }, {
      GATEWAY_TLS_ENABLED: "true",
      GATEWAY_TLS_CA_FILE: caCertPath,
      GATEWAY_TLS_CERT_FILE: serverCertPath,
      GATEWAY_TLS_KEY_FILE: serverKeyPath,
    });
    listener = await listenOnGatewaySocket(server, socketPath, process.getuid?.() ?? 0);
  });

  afterAll(async () => {
    await listener.close();
  });

  /** 指定したクライアント証明書（省略可）で接続し、成功すればステータス、失敗すればエラーで解決する。 */
  function connect(clientCert?: { cert: string; key: string }): Promise<{ status: number } | { error: true }> {
    return new Promise((resolve) => {
      const req = httpsRequest(
        {
          socketPath,
          path: "/net/status",
          method: "GET",
          ca: readFileSync(caCertPath),
          cert: clientCert ? readFileSync(clientCert.cert) : undefined,
          key: clientCert ? readFileSync(clientCert.key) : undefined,
          rejectUnauthorized: true,
          servername: "proxy-server",
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

  it("UDS のTLS listener はクライアント証明書無しの接続を拒否する", async () => {
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

describe("TLS無効時のGateway UDS listener", () => {
  it("証明書なしのHTTP over UDSで制御応答を返す", async () => {
    const socketPath = join(dir, "gateway-http.sock");
    const server = createGatewayChannelServer((_req, res) => res.end("ok"), { GATEWAY_TLS_ENABLED: "false" });
    const listener = await listenOnGatewaySocket(server, socketPath, process.getuid?.() ?? 0);
    const response = await new Promise<string>((resolve, reject) => {
      const request = httpRequest({ socketPath, path: "/", agent: false }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { body += chunk; });
        res.on("end", () => resolve(body));
      });
      request.once("error", reject);
      request.end();
    });
    expect(response).toBe("ok");
    await listener.close();
  });
});
