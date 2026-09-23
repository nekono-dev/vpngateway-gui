// 責務: loadApiServerTlsOptions（APIサーバ自身のHTTPS listen用サーバ証明書の読み込み）の単体テスト。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-api-tls-"));
const certPath = join(dir, "api-server.crt");
const keyPath = join(dir, "api-server.key");

beforeAll(() => {
  writeFileSync(certPath, "dummy-cert");
  writeFileSync(keyPath, "dummy-key");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadApiServerTlsOptions", () => {
  it("環境変数API_TLS_CERT_FILE・API_TLS_KEY_FILEで指定したファイルを読み込む", async () => {
    process.env.API_TLS_CERT_FILE = certPath;
    process.env.API_TLS_KEY_FILE = keyPath;
    const { loadApiServerTlsOptions } = await import("./tls-options.js");
    const options = loadApiServerTlsOptions();
    expect(options.cert.toString()).toBe(readFileSync(certPath, "utf8"));
    expect(options.key.toString()).toBe(readFileSync(keyPath, "utf8"));
  });

  it("証明書ファイルが読めない場合は例外を投げる", async () => {
    process.env.API_TLS_CERT_FILE = join(dir, "does-not-exist.crt");
    process.env.API_TLS_KEY_FILE = keyPath;
    const { loadApiServerTlsOptions } = await import("./tls-options.js");
    expect(() => loadApiServerTlsOptions()).toThrow();
    delete process.env.API_TLS_CERT_FILE;
    delete process.env.API_TLS_KEY_FILE;
  });
});
