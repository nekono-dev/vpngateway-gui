// 責務: Gateway guard の nft batch 生成条件を検証する。

import { describe, expect, it } from "vitest";
import {
  buildGuardBootstrapBatch,
  buildGuardLeaseRefreshBatch,
  buildGuardStateBatch,
  GUARD_CHAIN_NAME,
  GUARD_LEASE_SET_NAME,
  GUARD_TABLE_NAME,
} from "./guard-ruleset.js";

describe("guard nft batch 生成", () => {
  it("bootstrap だけが table/set/chain を作成し、BLOCK で初期化する", () => {
    const batch = buildGuardBootstrapBatch("eth0");
    const lines = batch.trim().split("\n");

    expect(lines).toEqual([
      `add table inet ${GUARD_TABLE_NAME}`,
      `add set inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME} { type ifname; flags timeout; }`,
      `add chain inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME} { type filter hook forward priority -1; policy accept; }`,
      `flush chain inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME}`,
      `flush set inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME}`,
      `add rule inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME} iifname "eth0" drop`,
    ]);
  });

  it("各状態遷移は既存 chain/set の flush と必要な規則・要素だけを出す", () => {
    for (const state of ["BLOCK", "LEASE", "OFF"] as const) {
      const batch = buildGuardStateBatch(state, "br-lan");
      expect(batch).toContain(`flush chain inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME}`);
      expect(batch).toContain(`flush set inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME}`);
      expect(batch).not.toMatch(/^add (?:table|set|chain) /m);
    }

    expect(buildGuardStateBatch("BLOCK", "br-lan")).toBe(
      `flush chain inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME}\n` +
        `flush set inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME}\n` +
        `add rule inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME} iifname "br-lan" drop\n`,
    );
    expect(buildGuardStateBatch("OFF", "br-lan")).toBe(
      `flush chain inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME}\n` +
        `flush set inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME}\n`,
    );
  });

  it("LEASE は要素追加と失効時 drop 規則を同じ batch に含める", () => {
    const batch = buildGuardStateBatch("LEASE", "eth0");
    const lines = batch.trim().split("\n");

    expect(lines).toEqual([
      `flush chain inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME}`,
      `flush set inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME}`,
      `add element inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME} { "eth0" timeout 4s }`,
      `add rule inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME} iifname @${GUARD_LEASE_SET_NAME} return`,
      `add rule inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME} iifname "eth0" drop`,
    ]);
  });

  it("lease 更新 batch は set の要素だけを置き換える", () => {
    expect(buildGuardLeaseRefreshBatch("eth0")).toBe(
      `flush set inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME}\n` +
        `add element inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME} { "eth0" timeout 4s }\n`,
    );
  });

  it("nft 文字列へ埋め込む interface 名の不正形式を拒否する", () => {
    expect(() => buildGuardBootstrapBatch('eth0" drop')).toThrow(/invalid interface name/);
    expect(() => buildGuardStateBatch("LEASE", "eth0; flush ruleset")).toThrow(/invalid interface name/);
    expect(() => buildGuardLeaseRefreshBatch("")).toThrow(/invalid interface name/);
  });
});
