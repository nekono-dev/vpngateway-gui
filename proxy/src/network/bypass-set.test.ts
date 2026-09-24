// 責務: 迂回対象アドレスの保持（bypass-set.ts）の単体テスト。

import { describe, expect, it } from "vitest";
import { BYPASS_GRACE_SECONDS, BypassSet, isBypassableAddress } from "./bypass-set.js";

describe("BypassSet", () => {
  it("TTLに猶予を加えた期限で登録し、時間経過で残り期限が減る", () => {
    let now = 0;
    const set = new BypassSet(() => now);
    expect(set.add([{ address: "192.0.2.1", ttl: 60 }])).toEqual([{ address: "192.0.2.1", timeoutSeconds: 60 + BYPASS_GRACE_SECONDS }]);
    now = 30_000;
    expect(set.live()).toEqual([{ address: "192.0.2.1", timeoutSeconds: 90 }]);
  });

  it("期限を過ぎた要素は取り除く", () => {
    let now = 0;
    const set = new BypassSet(() => now);
    set.add([{ address: "192.0.2.1", ttl: 0 }]);
    now = (BYPASS_GRACE_SECONDS + 1) * 1000;
    expect(set.live()).toEqual([]);
    expect(set.size()).toBe(0);
  });

  it("同じアドレスを再登録すると期限が延びる（短い期限では縮めない）", () => {
    let now = 0;
    const set = new BypassSet(() => now);
    set.add([{ address: "192.0.2.1", ttl: 300 }]);
    set.add([{ address: "192.0.2.1", ttl: 10 }]);
    expect(set.live()[0].timeoutSeconds).toBe(360);
  });

  it("異常に長いTTLは上限（3600秒）に丸める", () => {
    const set = new BypassSet(() => 0);
    expect(set.add([{ address: "192.0.2.1", ttl: 4_000_000_000 }])[0].timeoutSeconds).toBe(3600 + BYPASS_GRACE_SECONDS);
  });

  it("迂回に意味のないアドレス（0.0.0.0・ループバック・リンクローカル・不正形式）は登録しない", () => {
    const set = new BypassSet(() => 0);
    const added = set.add(["0.0.0.0", "127.0.0.1", "169.254.1.1", "999.1.1.1", "a.b.c.d"].map((address) => ({ address, ttl: 60 })));
    expect(added).toEqual([]);
    expect(set.size()).toBe(0);
  });
});

describe("isBypassableAddress", () => {
  it("通常のグローバル・プライベートアドレスは対象", () => {
    expect(isBypassableAddress("203.0.113.5")).toBe(true);
    expect(isBypassableAddress("192.168.3.1")).toBe(true);
  });
});
