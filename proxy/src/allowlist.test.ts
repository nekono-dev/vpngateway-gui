// 責務: 実行可能バイナリ許可リスト（allowlist.ts）の単体テスト。
// 追加許可（EXTRA_ALLOWED_BINARIES）がE2E専用の緩和として、絶対パスのみを受け付けることを確認する。

import { afterEach, describe, expect, it } from "vitest";
import { isAllowedBinary } from "./allowlist.js";

describe("isAllowedBinary", () => {
  afterEach(() => {
    delete process.env.EXTRA_ALLOWED_BINARIES;
  });

  it("ハードコードされたベンダーCLIを許可する", () => {
    expect(isAllowedBinary("/usr/local/bin/adguardvpn-cli")).toBe(true);
    expect(isAllowedBinary("/usr/bin/protonvpn")).toBe(true);
  });

  it("許可リスト外のバイナリは拒否する", () => {
    expect(isAllowedBinary("/bin/sh")).toBe(false);
    expect(isAllowedBinary("protonvpn")).toBe(false);
  });

  it("EXTRA_ALLOWED_BINARIESに指定した絶対パスを追加で許可する", () => {
    process.env.EXTRA_ALLOWED_BINARIES = "/usr/local/bin/protonvpn-mock, /opt/other";
    expect(isAllowedBinary("/usr/local/bin/protonvpn-mock")).toBe(true);
    expect(isAllowedBinary("/opt/other")).toBe(true);
    expect(isAllowedBinary("/bin/sh")).toBe(false);
  });

  it("EXTRA_ALLOWED_BINARIESの相対パス・空要素は無視する", () => {
    process.env.EXTRA_ALLOWED_BINARIES = "sh, ,./evil,";
    expect(isAllowedBinary("sh")).toBe(false);
    expect(isAllowedBinary("./evil")).toBe(false);
    expect(isAllowedBinary("")).toBe(false);
  });
});
