// 責務: nftの読み取り結果の解析（nft-listing.ts）の単体テスト。実機のnft 1.0.9の出力形式を用いる。

import { describe, expect, it } from "vitest";
import { parseSetElements, parseTableListing } from "./nft-listing.js";
import { SAMPLE_LISTING } from "./test-fixtures.js";


describe("parseTableListing", () => {
  it("チェーンごとのルール行を取り出す（宣言行・setは含めない）", () => {
    const chains = parseTableListing(SAMPLE_LISTING);
    expect([...chains.keys()]).toEqual(["postrouting", "forward", "bypass_mark", "dns_redirect"]);
    expect(chains.get("postrouting")).toEqual(['meta mark 0x00000100 oifname "eth0" masquerade', 'oifname "tun0" masquerade']);
    expect(chains.get("forward")?.at(-1)).toBe('iifname "eth0" drop');
  });

  it("空の出力は空の対応", () => {
    expect(parseTableListing("").size).toBe(0);
  });
});

describe("parseSetElements", () => {
  it("要素のアドレスと残り期限を取り出す（期限の無い要素は文字列で並ぶ）", () => {
    const json = JSON.stringify({
      nftables: [
        { metainfo: { version: "1.0.9" } },
        { set: { name: "redirected4", elem: [{ elem: { val: "192.168.3.20", expires: 596 } }, "192.168.3.21"] } },
      ],
    });
    expect(parseSetElements(json)).toEqual([
      { address: "192.168.3.20", expiresSeconds: 596 },
      { address: "192.168.3.21", expiresSeconds: undefined },
    ]);
  });

  it("要素が無いsetは空配列、JSONとして不正・setが無ければundefined", () => {
    expect(parseSetElements(JSON.stringify({ nftables: [{ metainfo: {} }, { set: { name: "x" } }] }))).toEqual([]);
    expect(parseSetElements("not json")).toBeUndefined();
    expect(parseSetElements(JSON.stringify({ nftables: [{ metainfo: {} }] }))).toBeUndefined();
  });
});
