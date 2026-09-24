// 責務: ClientIDの生成（client-id.ts）の単体テスト。

import { describe, expect, it, vi } from "vitest";
import { ClientIdResolver, LOCAL_CLIENT_ID, buildClientId, sanitizeClientName } from "./client-id.js";

describe("sanitizeClientName", () => {
  it("小文字化し、英数字以外の連続をハイフン1つにする（DHCPが配る名前を整える）", () => {
    expect(sanitizeClientName("Macmini.lan.")).toBe("macmini-lan");
    expect(sanitizeClientName("iPhone.lan")).toBe("iphone-lan");
    expect(sanitizeClientName("Taro's  iPhone (2).lan")).toBe("taro-s-iphone-2-lan");
  });

  it("63文字以内に切り、末尾のハイフンを残さない。使える文字が無ければundefined", () => {
    const long = sanitizeClientName(`${"a".repeat(62)}.example.lan`)!;
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long.endsWith("-")).toBe(false);
    expect(sanitizeClientName("...")).toBeUndefined();
    expect(sanitizeClientName("日本語")).toBeUndefined();
  });
});

describe("buildClientId", () => {
  it("名前があれば整えた名前、無ければIPベース（ip-…）、IPも不正ならunknown-client", () => {
    expect(buildClientId("192.168.3.121", "Macmini.lan.")).toBe("macmini-lan");
    expect(buildClientId("192.168.3.25", undefined)).toBe("192-168-3-25");
    expect(buildClientId("192.168.3.25", "日本語")).toBe("192-168-3-25");
    expect(buildClientId("bad", undefined)).toBe("unknown-client");
  });

  it("ClientIDの制約（小文字英数字とハイフン、63文字以内）を満たす", () => {
    expect(buildClientId("192.168.3.25", undefined)).toMatch(/^[a-z0-9-]{1,63}$/);
    expect(buildClientId("192.168.3.121", "Macmini.lan.")).toMatch(/^[a-z0-9-]{1,63}$/);
  });
});

describe("ClientIdResolver", () => {
  it("ゲートウェイ自身からの問い合わせは固定のIDにし、逆引きしない", async () => {
    const lookup = vi.fn(async () => "x.lan");
    const resolver = new ClientIdResolver(["127.0.0.1"], lookup);
    expect(await resolver.resolve("127.0.0.1")).toBe(LOCAL_CLIENT_ID);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("逆引きで名前が得られればその名前、得られなければIPベース", async () => {
    const names: Record<string, string> = { "192.168.3.121": "Macmini.lan." };
    const resolver = new ClientIdResolver(["127.0.0.1"], async (ip) => names[ip]);
    expect(await resolver.resolve("192.168.3.121")).toBe("macmini-lan");
    expect(await resolver.resolve("192.168.3.58")).toBe("192-168-3-58");
  });

  it("逆引きは結果をキャッシュする（名前あり10分、なし2分）。期限後は取り直す", async () => {
    let time = 0;
    const lookup = vi.fn(async () => undefined as string | undefined);
    const resolver = new ClientIdResolver(["127.0.0.1"], lookup, () => time);
    await resolver.resolve("192.168.3.58");
    time = 60_000;
    await resolver.resolve("192.168.3.58");
    expect(lookup).toHaveBeenCalledTimes(1);
    time = 121_000;
    lookup.mockResolvedValue("Late.lan");
    expect(await resolver.resolve("192.168.3.58")).toBe("late-lan");
    time = 121_000 + 9 * 60_000;
    await resolver.resolve("192.168.3.58");
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("並行した問い合わせで、逆引きを重複させない", async () => {
    const lookup = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "a.lan";
    });
    const resolver = new ClientIdResolver(["127.0.0.1"], lookup);
    const ids = await Promise.all([resolver.resolve("192.168.3.9"), resolver.resolve("192.168.3.9"), resolver.resolve("192.168.3.9")]);
    expect(ids).toEqual(["a-lan", "a-lan", "a-lan"]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("逆引きが遅い・失敗する場合は、待ち時間を超えたらIPベースで進める（問い合わせを止めない）", async () => {
    const slow = new ClientIdResolver(["127.0.0.1"], () => new Promise(() => undefined), () => 0, 30);
    expect(await slow.resolve("192.168.3.9")).toBe("192-168-3-9");
    const failing = new ClientIdResolver(["127.0.0.1"], async () => {
      throw new Error("down");
    });
    expect(await failing.resolve("192.168.3.9")).toBe("192-168-3-9");
  });

  it("clear()で保持を捨て、設定の変更後に取り直す", async () => {
    const lookup = vi.fn(async () => undefined as string | undefined);
    const resolver = new ClientIdResolver(["127.0.0.1"], lookup);
    await resolver.resolve("192.168.3.9");
    resolver.clear();
    await resolver.resolve("192.168.3.9");
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
