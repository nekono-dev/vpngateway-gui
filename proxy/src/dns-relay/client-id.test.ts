// 責務: ClientIDの生成（client-id.ts）の単体テスト。

import { describe, expect, it } from "vitest";
import { ClientIdResolver, LOCAL_CLIENT_ID, buildClientId, parseArpTable } from "./client-id.js";

const ARP = `IP address       HW type     Flags       HW address            Mask     Device
192.168.3.25     0x1         0x2         AA:bb:cc:dd:ee:ff     *        eth0
192.168.3.30     0x1         0x0         00:00:00:00:00:00     *        eth0
192.168.3.31     0x1         0x2         00:00:00:00:00:00     *        eth0
`;

describe("parseArpTable", () => {
  it("完了したエントリのMACを小文字で取り出し、未完了のものは除く", () => {
    const table = parseArpTable(ARP);
    expect(table.get("192.168.3.25")).toBe("aa:bb:cc:dd:ee:ff");
    expect(table.has("192.168.3.30")).toBe(false);
    expect(table.has("192.168.3.31")).toBe(false);
  });
});

describe("buildClientId", () => {
  it("MACがあれば mac-…、なければ ip-…、IPも不正なら unknown-client", () => {
    expect(buildClientId("192.168.3.25", "aa:bb:cc:dd:ee:ff")).toBe("mac-aa-bb-cc-dd-ee-ff");
    expect(buildClientId("192.168.3.25", undefined)).toBe("ip-192-168-3-25");
    expect(buildClientId("bad", undefined)).toBe("unknown-client");
    expect(buildClientId("192.168.3.25", "zz")).toBe("ip-192-168-3-25");
  });

  it("ClientIDの制約（小文字英数字とハイフン、63文字以内）を満たす", () => {
    expect(buildClientId("192.168.3.25", "aa:bb:cc:dd:ee:ff")).toMatch(/^[a-z0-9-]{1,63}$/);
  });
});

describe("ClientIdResolver", () => {
  it("ゲートウェイ自身からの問い合わせは固定のIDにする", () => {
    const resolver = new ClientIdResolver(["127.0.0.1"], () => ARP);
    expect(resolver.resolve("127.0.0.1")).toBe(LOCAL_CLIENT_ID);
  });

  it("ARPを引いてMAC由来のIDを返し、キャッシュ期間内は再読込しない", () => {
    let reads = 0;
    let time = 0;
    const resolver = new ClientIdResolver(["127.0.0.1"], () => (reads += 1, ARP), () => time);
    expect(resolver.resolve("192.168.3.25")).toBe("mac-aa-bb-cc-dd-ee-ff");
    time = 10_000;
    expect(resolver.resolve("192.168.3.25")).toBe("mac-aa-bb-cc-dd-ee-ff");
    expect(reads).toBe(1);
  });

  it("未知のIPはキャッシュ期間内でも読み直し、それでも無ければIP由来のID", () => {
    let reads = 0;
    const resolver = new ClientIdResolver(["127.0.0.1"], () => (reads += 1, ARP), () => 0);
    expect(resolver.resolve("192.168.3.99")).toBe("ip-192-168-3-99");
    expect(reads).toBe(1);
  });

  it("ARPの読み取りに失敗してもIP由来のIDを返す", () => {
    const resolver = new ClientIdResolver(["127.0.0.1"], () => {
      throw new Error("no arp");
    });
    expect(resolver.resolve("192.168.3.25")).toBe("ip-192-168-3-25");
  });
});
