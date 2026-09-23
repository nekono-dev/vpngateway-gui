// 責務: ログイン試行・パスワード変更のレート制限（送信元IPごと）の単体テスト。

import { describe, expect, it } from "vitest";
import { clearFailures, isRateLimited, recordFailure } from "./login-rate-limiter.js";

describe("login-rate-limiter", () => {
  it("失敗5回未満ならisRateLimited=false", () => {
    const ip = "192.0.2.1";
    for (let i = 0; i < 4; i++) {
      recordFailure(ip);
    }
    expect(isRateLimited(ip)).toBe(false);
  });

  it("失敗5回に達するとisRateLimited=true", () => {
    const ip = "192.0.2.2";
    for (let i = 0; i < 5; i++) {
      recordFailure(ip);
    }
    expect(isRateLimited(ip)).toBe(true);
  });

  it("clearFailuresで記録が消え、isRateLimited=falseに戻る", () => {
    const ip = "192.0.2.3";
    for (let i = 0; i < 5; i++) {
      recordFailure(ip);
    }
    clearFailures(ip);
    expect(isRateLimited(ip)).toBe(false);
  });

  it("IPごとに独立して数える", () => {
    const ipA = "192.0.2.4";
    const ipB = "192.0.2.5";
    for (let i = 0; i < 5; i++) {
      recordFailure(ipA);
    }
    expect(isRateLimited(ipA)).toBe(true);
    expect(isRateLimited(ipB)).toBe(false);
  });
});
