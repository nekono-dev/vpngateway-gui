// 責務: Gateway guard の初期化・状態遷移・lease 更新用 nft batch を生成する。

import { isValidInterfaceName } from "../lib/interface-name.js";

export const GUARD_TABLE_NAME = "vpngwgui_guard";
export const GUARD_LEASE_SET_NAME = "healthy_lease4";
export const GUARD_CHAIN_NAME = "guard_forward";
export const GUARD_LEASE_TIMEOUT_SECONDS = 4;

export type GuardState = "BLOCK" | "LEASE" | "OFF";

/**
 * 目的: boot unit が一度だけ実行する guard の土台と初期 BLOCK batch を生成する。
 * 入力: lanIface（LAN 側インターフェース名）。
 * 出力: `nft -f -` に渡す改行区切りの batch。
 * 失敗時の方針: nft 文字列へ埋め込めない interface 名は例外にする。
 */
export function buildGuardBootstrapBatch(lanIface: string): string {
  validateInterfaceName(lanIface);
  return [
    `add table inet ${GUARD_TABLE_NAME}`,
    `add set inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME} { type ifname; flags timeout; }`,
    `add chain inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME} { type filter hook forward priority -1; policy accept; }`,
    ...buildGuardStateLines("BLOCK", lanIface),
  ].join("\n") + "\n";
}

/**
 * 目的: 既存 guard の chain/set を単一 batch で指定状態へ切り替える。
 * 入力: state（BLOCK/LEASE/OFF）、lanIface（LAN 側インターフェース名）。
 * 出力: 既存 chain/set の flush と状態に必要な規則・要素だけを含む batch。
 * 失敗時の方針: nft 文字列へ埋め込めない interface 名は例外にする。
 */
export function buildGuardStateBatch(state: GuardState, lanIface: string): string {
  validateInterfaceName(lanIface);
  return buildGuardStateLines(state, lanIface).join("\n") + "\n";
}

/**
 * 目的: healthy な LEASE 状態の期限付き要素だけを更新する batch を生成する。
 * 入力: lanIface（LAN 側インターフェース名）。
 * 出力: 既存 set の flush と期限付き要素を含む batch。
 * 失敗時の方針: nft 文字列へ埋め込めない interface 名は例外にする。
 */
export function buildGuardLeaseRefreshBatch(lanIface: string): string {
  validateInterfaceName(lanIface);
  return [
    `flush set inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME}`,
    leaseElement(lanIface),
  ].join("\n") + "\n";
}

function buildGuardStateLines(state: GuardState, lanIface: string): string[] {
  const lines = [
    `flush chain inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME}`,
    `flush set inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME}`,
  ];

  if (state === "BLOCK") {
    lines.push(dropRule(lanIface));
  } else if (state === "LEASE") {
    lines.push(leaseElement(lanIface));
    lines.push(`add rule inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME} iifname @${GUARD_LEASE_SET_NAME} return`);
    lines.push(dropRule(lanIface));
  }

  return lines;
}

function leaseElement(lanIface: string): string {
  return `add element inet ${GUARD_TABLE_NAME} ${GUARD_LEASE_SET_NAME} { "${lanIface}" timeout ${GUARD_LEASE_TIMEOUT_SECONDS}s }`;
}

function dropRule(lanIface: string): string {
  return `add rule inet ${GUARD_TABLE_NAME} ${GUARD_CHAIN_NAME} iifname "${lanIface}" drop`;
}

function validateInterfaceName(lanIface: string): void {
  if (!isValidInterfaceName(lanIface)) {
    throw new Error(`invalid interface name: ${lanIface}`);
  }
}
