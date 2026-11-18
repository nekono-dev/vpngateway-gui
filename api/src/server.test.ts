// 責務: API の実 HTTP listener が TLS 証明書なしで起動し、HTTP 要求を処理することを検証する。

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const dataDir = mkdtempSync(join(tmpdir(), "vpngwgui-api-http-"));
process.env.SETTINGS_FILE = join(dataDir, "settings.json");
const tlsEnvironmentNames = [
  "API_TLS_CERT_FILE", "API_TLS_KEY_FILE", "API_TLS_CA_FILE", "GATEWAY_PKI_DIR", "GATEWAY_TLS_ENABLED",
  "GATEWAY_TLS_CA_FILE", "GATEWAY_TLS_CERT_FILE", "GATEWAY_TLS_KEY_FILE", "GATEWAY_TLS_CLIENT_CERT_FILE",
  "GATEWAY_TLS_CLIENT_KEY_FILE", "WEB_HTTPS_ENABLED", "WEB_TLS_CERT_FILE", "WEB_TLS_KEY_FILE",
];
for (const name of tlsEnvironmentNames) delete process.env[name];

const { startApiServer } = await import("./server.js");

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("API HTTP listener", () => {
  it("TLS 環境変数と PKI がなくても実 HTTP 要求を処理する", async () => {
    expect(tlsEnvironmentNames.every((name) => process.env[name] === undefined)).toBe(true);
    const app = await startApiServer({}, { port: 0, host: "127.0.0.1" });

    try {
      const address = app.server.address() as AddressInfo;
      const response = await requestJson(address.port, "/openapi.json");

      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({ openapi: expect.any(String), paths: expect.any(Object) });
    } finally {
      await app.close();
    }
  });
});

function requestJson(port: number, path: string): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve({ statusCode: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("API HTTPS flag", () => {
  it.each(["TRUE", "1", "yes", "", " true"])('不正な WEB_HTTPS_ENABLED "%s" では listener を開始しない', async (value) => {
    await expect(startApiServer({ WEB_HTTPS_ENABLED: value }, { port: 0, host: "127.0.0.1" })).rejects.toThrow(/WEB_HTTPS_ENABLED/);
  });
});
