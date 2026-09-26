// 責務: 53番リダイレクトの誘導の判定（redirect-record.ts）の単体テスト。

import { describe, expect, it } from "vitest";
import { wasJustRedirected } from "./redirect-record.js";

describe("wasJustRedirected", () => {
  it("送信元の要素の残り期限が、保持期間（600秒）から5秒以内ならtrue", () => {
    expect(wasJustRedirected([{ address: "192.168.3.20", expiresSeconds: 599 }], "192.168.3.20")).toBe(true);
    expect(wasJustRedirected([{ address: "192.168.3.20", expiresSeconds: 595 }], "192.168.3.20")).toBe(true);
  });

  it("以前に誘導されただけ（残り期限が短い）、要素が無い、期限の情報が無い場合はfalse", () => {
    expect(wasJustRedirected([{ address: "192.168.3.20", expiresSeconds: 400 }], "192.168.3.20")).toBe(false);
    expect(wasJustRedirected([{ address: "192.168.3.21", expiresSeconds: 599 }], "192.168.3.20")).toBe(false);
    expect(wasJustRedirected([{ address: "192.168.3.20", expiresSeconds: undefined }], "192.168.3.20")).toBe(false);
  });
});
