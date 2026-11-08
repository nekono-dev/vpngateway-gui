// 責務: 経路の指定（ChainSpec）のスキーマが、有効な指定を通し、無効な指定を拒否することを確かめる。
import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { ChainSpecSchema } from "./chain-spec.js";

const exitOnly = { exit: { locationId: "JP-tokyo" }, hops: [] };

describe("ChainSpecSchema", () => {
  it("段数 1（出口だけ）の指定を通す", () => {
    expect(Value.Check(ChainSpecSchema, exitOnly)).toBe(true);
  });

  it("段ごとの選び方・提供元・切断時の動作を持つ指定を通す", () => {
    const spec = {
      exit: { locationId: "US-seattle" },
      hops: [
        { selection: "random", provider: "exit", onFailure: "blockAll" },
        { selection: "manual", provider: "adguardvpn", manualLocationId: "DE-berlin", onFailure: "dropHop" },
      ],
    };
    expect(Value.Check(ChainSpecSchema, spec)).toBe(true);
  });

  it("手動選択なのに接続先の指定がない段を拒否する", () => {
    const spec = {
      exit: { locationId: "US-seattle" },
      hops: [{ selection: "manual", provider: "exit", onFailure: "blockAll" }],
    };
    expect(Value.Check(ChainSpecSchema, spec)).toBe(false);
  });

  it("手動選択以外に接続先を指定した段を拒否する", () => {
    const spec = {
      exit: { locationId: "US-seattle" },
      hops: [{ selection: "random", provider: "exit", manualLocationId: "DE-berlin", onFailure: "blockAll" }],
    };
    expect(Value.Check(ChainSpecSchema, spec)).toBe(false);
  });

  it("切断時の動作が既定の範囲外なら拒否する", () => {
    const spec = {
      exit: { locationId: "US-seattle" },
      hops: [{ selection: "random", provider: "exit", onFailure: "ignore" }],
    };
    expect(Value.Check(ChainSpecSchema, spec)).toBe(false);
  });
});
