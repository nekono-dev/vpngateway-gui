// 責務: 設定の読み取りと CI 拒否（config.ts）の単体テスト。設定に資格情報を書けないことを確かめる（要件 1.7・5.4・7.2）。

import { describe, expect, it } from "vitest";
import { assertNotCi, parseConfig } from "./config";

const valid = JSON.stringify({ webBaseUrl: "https://gateway.example.test", webCaPath: "/home/dev/.config/vpngwgui-e2e/web-ca.crt" });

describe("assertNotCi", () => {
  it.each([{ CI: "true" }, { GITHUB_ACTIONS: "true" }, { GITLAB_CI: "1" }])("CI 環境 %j からの起動を拒否する", (env) => {
    expect(() => assertNotCi(env)).toThrow("手動で起動");
  });

  it("CI 環境変数が無ければ起動できる", () => {
    expect(() => assertNotCi({ HOME: "/home/dev" })).not.toThrow();
  });
});

describe("parseConfig", () => {
  it("Web 公開 URL・任意の Web CA・既定の成果物の場所を読む", () => {
    expect(parseConfig(valid)).toEqual({
      webBaseUrl: "https://gateway.example.test",
      webCaPath: "/home/dev/.config/vpngwgui-e2e/web-ca.crt",
      artifactsDir: "e2e/artifacts/vendor-live",
    });
  });

  it("HTTP の Web 公開 URL と CA なしを受け付ける", () => {
    expect(parseConfig(JSON.stringify({ webBaseUrl: "http://gateway.example.test" }))).toEqual({
      webBaseUrl: "http://gateway.example.test",
      artifactsDir: "e2e/artifacts/vendor-live",
    });
  });

  it("HTTP の Web URL では Web CA を受け付けない", () => {
    expect(() => parseConfig(JSON.stringify({ webBaseUrl: "http://gateway.example.test", webCaPath: "/x.crt" }))).toThrow("HTTPS のときだけ");
  });

  it("資格情報のキーを含む設定を拒否し、値を例外に含めない", () => {
    const raw = JSON.stringify({ webBaseUrl: "https://gateway.example.test", password: "hunter2" });
    expect(() => parseConfig(raw)).toThrow("許可されていないキー「password」");
    expect(() => parseConfig(raw)).not.toThrow(/hunter2/);
  });

  it("API の直接 URL と API CA の設定を拒否する", () => {
    const apiUrl = JSON.stringify({ apiBaseUrl: "https://192.168.3.240:3000" });
    expect(() => parseConfig(apiUrl)).toThrow(/apiBaseUrl.*webBaseUrl/);
    expect(() => parseConfig(apiUrl)).toThrow(/\/api を付けない/);

    const apiCa = JSON.stringify({ caPath: "/secret/path.crt" });
    expect(() => parseConfig(apiCa)).toThrow(/caPath.*webCaPath/);
    expect(() => parseConfig(apiCa)).toThrow(/HTTPS.*信頼.*HTTP.*削除/);
    expect(() => parseConfig(apiCa)).not.toThrow(/secret/);
  });

  it("旧キーに新キーを併記しても移行扱いせず拒否し、値を表示しない", () => {
    const mappedApiUrl = JSON.stringify({ apiBaseUrl: "https://secret.example/api", webBaseUrl: "https://gateway.example.test" });
    const mappedCa = JSON.stringify({ caPath: "/secret/old.crt", webCaPath: "/new/web.crt", webBaseUrl: "https://gateway.example.test" });

    expect(() => parseConfig(mappedApiUrl)).toThrow(/apiBaseUrl.*webBaseUrl/);
    expect(() => parseConfig(mappedApiUrl)).not.toThrow(/secret/);
    expect(() => parseConfig(mappedCa)).toThrow(/caPath.*webCaPath/);
    expect(() => parseConfig(mappedCa)).not.toThrow(/secret/);
  });

  it("HTTPS の URL だけを許可し、URL 内の path を拒否する", () => {
    expect(() => parseConfig(JSON.stringify({ webBaseUrl: "ftp://gateway.example.test" }))).toThrow("http または https");
    expect(() => parseConfig(JSON.stringify({ webBaseUrl: "https://gateway.example.test/path" }))).toThrow("origin");
  });
});
