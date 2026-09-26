// 責務: 検証名の登録・受信の記録（check-nonces.ts）の単体テスト。

import { describe, expect, it } from "vitest";
import { CheckNonceRegistry, isValidCheckNonce } from "./check-nonces.js";

describe("isValidCheckNonce", () => {
  it("`vpngw-<乱数>.<ドメイン>`の形式と1〜300秒の有効期間のみ許可する", () => {
    expect(isValidCheckNonce("vpngw-k3f9x2ab.example.com", 60)).toBe(true);
    expect(isValidCheckNonce("vpngw-short.example.com", 60)).toBe(false);
    expect(isValidCheckNonce("other-k3f9x2ab.example.com", 60)).toBe(false);
    expect(isValidCheckNonce("vpngw-k3f9x2ab", 60)).toBe(false);
    expect(isValidCheckNonce("vpngw-k3f9x2ab.example.com", 0)).toBe(false);
    expect(isValidCheckNonce("vpngw-k3f9x2ab.example.com", 301)).toBe(false);
  });
});

describe("CheckNonceRegistry", () => {
  it("登録した名前だけを期限内に扱い、受信と誘導の有無を記録する（大文字小文字は区別しない）", () => {
    let now = 0;
    const registry = new CheckNonceRegistry(() => now);
    registry.register("vpngw-k3f9x2ab.example.com", 60);
    expect(registry.has("VPNGW-k3f9x2ab.example.com")).toBe(true);
    expect(registry.has("vpngw-other000.example.com")).toBe(false);
    expect(registry.get("vpngw-k3f9x2ab.example.com")).toEqual({ received: false, redirected: false });

    registry.markReceived("vpngw-k3f9x2ab.example.com", true);
    // 同じ名前を誘導なしで再度受信しても、誘導ありの記録は残す（ブラウザの再試行等）。
    registry.markReceived("vpngw-k3f9x2ab.example.com", false);
    expect(registry.get("vpngw-k3f9x2ab.example.com")).toEqual({ received: true, redirected: true });

    now = 60_000;
    expect(registry.has("vpngw-k3f9x2ab.example.com")).toBe(false);
    expect(registry.get("vpngw-k3f9x2ab.example.com")).toBeUndefined();
  });

  it("登録数の上限を超えると、古いものから捨てる", () => {
    const registry = new CheckNonceRegistry(() => 0);
    for (let index = 0; index < 17; index += 1) registry.register(`vpngw-name${String(index).padStart(4, "0")}.example.com`, 60);
    expect(registry.has("vpngw-name0000.example.com")).toBe(false);
    expect(registry.has("vpngw-name0016.example.com")).toBe(true);
  });
});
