// 責務: ランナーの許可バイナリ（allowlist.ts）の単体テスト。
// 許可は環境変数RUNNER_ALLOWED_BINARYの1つだけで、未設定・相対パスでは何も許可しないことを確認する。

import { afterEach, describe, expect, it } from "vitest";
import { getAllowedBinary, isAllowedBinary } from "./allowlist.js";

describe("isAllowedBinary", () => {
  afterEach(() => {
    delete process.env.RUNNER_ALLOWED_BINARY;
  });

  it("RUNNER_ALLOWED_BINARYに一致するバイナリだけを許可する", () => {
    process.env.RUNNER_ALLOWED_BINARY = "/usr/bin/protonvpn";
    expect(isAllowedBinary("/usr/bin/protonvpn")).toBe(true);
  });

  it("別ベンダーのバイナリ・任意のコマンドは拒否する（他ランナー経由の踏み台を防ぐ）", () => {
    process.env.RUNNER_ALLOWED_BINARY = "/usr/bin/protonvpn";
    expect(isAllowedBinary("/usr/local/bin/adguardvpn-cli")).toBe(false);
    expect(isAllowedBinary("/bin/sh")).toBe(false);
    expect(isAllowedBinary("protonvpn")).toBe(false);
  });

  it("未設定なら何も許可しない", () => {
    expect(isAllowedBinary("/usr/bin/protonvpn")).toBe(false);
    expect(getAllowedBinary()).toBeUndefined();
  });

  it("相対パスの設定は無効（何も許可しない）", () => {
    process.env.RUNNER_ALLOWED_BINARY = "protonvpn";
    expect(isAllowedBinary("protonvpn")).toBe(false);
  });
});
