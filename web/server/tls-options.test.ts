// 責務: Web HTTPS 設定の既定値、証明書読込、TLS 鍵ペア検証を確かめる。
import { describe, expect, it, vi } from "vitest";
import { loadWebServerHttpsOptions } from "./tls-options.js";

describe("Web HTTPS 設定", () => {
  it("未設定または false では HTTPS を無効にし、証明書を読まない", () => {
    const readFile = vi.fn(() => Buffer.from("unused"));

    expect(loadWebServerHttpsOptions({}, readFile)).toBeUndefined();
    expect(loadWebServerHttpsOptions({ WEB_HTTPS_ENABLED: "false" }, readFile)).toBeUndefined();
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each(["", "TRUE", "yes", "1", " false "])('strict boolean 以外の "%s" は失敗する', (value) => {
    expect(() => loadWebServerHttpsOptions({ WEB_HTTPS_ENABLED: value })).toThrow(/WEB_HTTPS_ENABLED/);
  });

  it("true では証明書と鍵を読み込み、TLS ペアを検証する", () => {
    const cert = Buffer.from("certificate");
    const key = Buffer.from("private key");
    const readFile = vi.fn((path: string) => path.endsWith(".crt") ? cert : key);
    const validatePair = vi.fn();

    expect(loadWebServerHttpsOptions({
      WEB_HTTPS_ENABLED: "true",
      WEB_TLS_CERT_FILE: "/server.crt",
      WEB_TLS_KEY_FILE: "/server.key",
    }, readFile, validatePair)).toEqual({ cert, key });
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(validatePair).toHaveBeenCalledWith({ cert, key });
  });

  it("証明書と鍵が一致しない場合は起動用設定の読込を失敗させる", () => {
    const readFile = vi.fn((path: string) => Buffer.from(path));

    expect(() => loadWebServerHttpsOptions(
      { WEB_HTTPS_ENABLED: "true", WEB_TLS_CERT_FILE: "/server.crt", WEB_TLS_KEY_FILE: "/server.key" },
      readFile,
      () => { throw new Error("key values mismatch"); },
    )).toThrow("key values mismatch");
  });

  it.each([
    [{ WEB_HTTPS_ENABLED: "true" }],
    [{ WEB_HTTPS_ENABLED: "true", WEB_TLS_CERT_FILE: "/cert.pem" }],
    [{ WEB_HTTPS_ENABLED: "true", WEB_TLS_KEY_FILE: "/key.pem" }],
  ])("HTTPS 有効時の証明書設定不足は失敗する", (env) => {
    expect(() => loadWebServerHttpsOptions(env)).toThrow();
  });
});
