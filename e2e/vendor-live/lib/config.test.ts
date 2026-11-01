// 責務: 設定の読み取りと CI 拒否（config.ts）の単体テスト。設定に資格情報を書けないことを確かめる（要件 1.7・5.4・7.2）。

import { describe, expect, it } from "vitest";
import { assertNotCi, parseConfig } from "./config";

const valid = JSON.stringify({ apiBaseUrl: "https://192.168.3.240:3000", caPath: "/home/dev/.config/vpngwgui-e2e/api-ca.crt" });

describe("assertNotCi", () => {
  it.each([{ CI: "true" }, { GITHUB_ACTIONS: "true" }, { GITLAB_CI: "1" }])("CI 環境 %j からの起動を拒否する", (env) => {
    expect(() => assertNotCi(env)).toThrow("手動で起動");
  });

  it("CI 環境変数が無ければ起動できる", () => {
    expect(() => assertNotCi({ HOME: "/home/dev" })).not.toThrow();
  });
});

describe("parseConfig", () => {
  it("API の URL・CA の場所・既定の成果物の場所を読む", () => {
    expect(parseConfig(valid)).toEqual({
      apiBaseUrl: "https://192.168.3.240:3000",
      caPath: "/home/dev/.config/vpngwgui-e2e/api-ca.crt",
      artifactsDir: "e2e/artifacts/vendor-live",
    });
  });

  it("資格情報のキーを含む設定を拒否し、値を例外に含めない", () => {
    const raw = JSON.stringify({ apiBaseUrl: "https://192.168.3.240:3000", caPath: "/x.crt", password: "hunter2" });
    expect(() => parseConfig(raw)).toThrow("許可されていないキー「password」");
    expect(() => parseConfig(raw)).not.toThrow(/hunter2/);
  });

  it("https 以外の URL を拒否する", () => {
    const raw = JSON.stringify({ apiBaseUrl: "http://192.168.3.240:3000", caPath: "/x.crt" });
    expect(() => parseConfig(raw)).toThrow("https");
  });
});
