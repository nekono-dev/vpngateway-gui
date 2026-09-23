// 責務: ログインセッションの保持・Cookieの解析/組み立ての単体テスト。

import { describe, expect, it } from "vitest";
import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  createSession,
  deleteSession,
  isValidSession,
  readSessionIdFromCookieHeader,
  SESSION_COOKIE_NAME,
} from "./session-store.js";

describe("session-store", () => {
  it("createSessionで発行したIDはisValidSession=trueになる", () => {
    const sessionId = createSession();
    expect(isValidSession(sessionId)).toBe(true);
  });

  it("未指定・未発行のIDはisValidSession=false", () => {
    expect(isValidSession(undefined)).toBe(false);
    expect(isValidSession("not-a-real-session-id")).toBe(false);
  });

  it("deleteSessionで破棄したIDはisValidSession=falseになる", () => {
    const sessionId = createSession();
    deleteSession(sessionId);
    expect(isValidSession(sessionId)).toBe(false);
  });

  it("readSessionIdFromCookieHeaderは複数Cookieの中から対象の値だけを取り出す", () => {
    const header = `other=1; ${SESSION_COOKIE_NAME}=abc123; another=2`;
    expect(readSessionIdFromCookieHeader(header)).toBe("abc123");
  });

  it("readSessionIdFromCookieHeaderは対象が無ければundefined", () => {
    expect(readSessionIdFromCookieHeader("other=1")).toBeUndefined();
    expect(readSessionIdFromCookieHeader(undefined)).toBeUndefined();
  });

  it("buildSessionCookieはsecure=trueならSecure属性を含み、falseなら含まない", () => {
    expect(buildSessionCookie("abc", true)).toContain("Secure");
    expect(buildSessionCookie("abc", false)).not.toContain("Secure");
    expect(buildSessionCookie("abc", true)).toContain("HttpOnly");
    expect(buildSessionCookie("abc", true)).toContain("SameSite=Lax");
  });

  it("buildExpiredSessionCookieはMax-Age=0を含む", () => {
    expect(buildExpiredSessionCookie(false)).toContain("Max-Age=0");
  });
});
