// 責務: 設定の動作検証のL1（構成の照合）。適用中のnftルール（nft-listing.tsで解析したチェーンごとのルール行）が、
// ゲートウェイの現在の状態（インターフェース・設定）に対応した形になっているかを判定する純粋関数群。
// チェーン・setの名前はルールセットの生成（network/ruleset.ts）と共有し、二重に定義しない。
// nftが正規化した表記（`0x00000100`等）に依存しないよう、ルールの特徴（インターフェース・動作）で照合する。

import { BYPASS_SET_NAME, CHAIN_BYPASS_MARK, CHAIN_DNS_REDIRECT, CHAIN_FORWARD, CHAIN_POSTROUTING, REDIRECTED_SET_NAME } from "../network/ruleset.js";
import { fail, pass, type CheckOutcome } from "./check-outcome.js";

type Chains = ReadonlyMap<string, readonly string[]>;

const RECONFIGURE_HINT =
  "設定を保存し直すと、ルールが再構成されます。解消しない場合は、ゲートウェイのログ（gateway_reconcile_error等）を確認してください。";

function rules(chains: Chains, chain: string): readonly string[] {
  return chains.get(chain) ?? [];
}

function hasRule(chains: Chains, chain: string, ...tokens: string[]): boolean {
  return rules(chains, chain).some((line) => tokens.every((token) => line.includes(token)));
}

function lanDropRule(lanIface: string): string {
  return `iifname "${lanIface}" drop`;
}

export interface GatewayRulesInput {
  lanIface: string | undefined;
  wanIface: string | undefined;
  vpnIface: string | undefined;
  killSwitch: boolean;
  ipForwardEnabled: boolean;
}

/**
 * 目的: 透過ゲートウェイの構成（`gateway-rules`）を照合する。
 * 入力: chains(適用中のテーブルのチェーン。テーブルが無ければundefined), input(現在の状態)。
 * 出力: forward末尾のLAN発のdrop、VPN接続中はトンネルへのNATと転送許可、IPフォワーディングの有効を満たせばpass。
 */
export function auditGatewayRules(chains: Chains | undefined, input: GatewayRulesInput): CheckOutcome {
  const expected = "LANからの転送を扱うルールが、VPNの接続状態に合わせて適用され、IPフォワーディングが有効";
  if (input.lanIface === undefined) {
    return fail(expected, "LAN側インターフェースが未設定", "インストーラを実行し、LAN側インターフェースを設定してください。");
  }
  if (chains === undefined) return fail(expected, "ゲートウェイのルールのテーブルが無い", RECONFIGURE_HINT);

  const missing: string[] = [];
  const forward = rules(chains, CHAIN_FORWARD);
  if (forward[forward.length - 1] !== lanDropRule(input.lanIface)) missing.push("転送の遮断ルール（末尾）が無い");
  if (input.vpnIface !== undefined) {
    if (!hasRule(chains, CHAIN_POSTROUTING, `oifname "${input.vpnIface}" masquerade`)) {
      missing.push(`VPNトンネル（${input.vpnIface}）へのNATが無い`);
    }
    if (!hasRule(chains, CHAIN_FORWARD, `iifname "${input.lanIface}" oifname "${input.vpnIface}" accept`)) {
      missing.push(`LANからVPNトンネル（${input.vpnIface}）への転送許可が無い`);
    }
  }
  if (!input.ipForwardEnabled) missing.push("IPフォワーディングが無効");
  if (missing.length > 0) {
    const hint = input.ipForwardEnabled
      ? RECONFIGURE_HINT
      : "ホストでIPフォワーディング（net.ipv4.ip_forward=1）を有効にしてください（インストーラの再実行で設定されます）。";
    return fail(expected, missing.join("、"), hint);
  }
  if (input.vpnIface !== undefined) {
    return pass(`LAN（${input.lanIface}）→ VPNトンネル（${input.vpnIface}）の転送とNATを確認`);
  }
  return pass(
    input.killSwitch
      ? "VPN未接続のため、LANからの転送は遮断中（Kill Switch）"
      : `VPN未接続のため、実回線（${input.wanIface ?? input.lanIface}）へ直接転送中（Kill Switchが無効）`,
  );
}

/**
 * 目的: Kill Switchの構成（`kill-switch-rules`）を照合する。
 * 入力: chains(適用中のテーブルのチェーン), input(現在の状態)。
 * 出力: forward末尾にLAN発のdropがあり、LANから実回線へ直接抜ける許可（フェイルオープン）が無ければpass。
 */
export function auditKillSwitchRules(chains: Chains | undefined, input: GatewayRulesInput): CheckOutcome {
  const expected = "VPNを経由しないLANからの転送を遮断し、VPN切断時に実回線へ抜ける許可が無い";
  if (input.lanIface === undefined) {
    return fail(expected, "LAN側インターフェースが未設定", "インストーラを実行し、LAN側インターフェースを設定してください。");
  }
  if (chains === undefined) return fail(expected, "ゲートウェイのルールのテーブルが無い", RECONFIGURE_HINT);
  const forward = rules(chains, CHAIN_FORWARD);
  const problems: string[] = [];
  if (forward[forward.length - 1] !== lanDropRule(input.lanIface)) problems.push("転送の遮断ルール（末尾）が無い");
  const wanIface = input.wanIface ?? input.lanIface;
  if (hasRule(chains, CHAIN_FORWARD, `iifname "${input.lanIface}" oifname "${wanIface}" accept`)) {
    problems.push("LANから実回線へ直接抜ける許可がある");
  }
  if (problems.length > 0) return fail(expected, problems.join("、"), RECONFIGURE_HINT);
  return pass("末尾の遮断ルールあり。VPN切断時に実回線へ抜ける許可なし");
}

export interface DnsRedirectRulesInput {
  lanIface: string | undefined;
  relayActive: boolean;
  // 構成中のリダイレクト（中継が待受していない間は構成しないためundefined）。
  redirect: { listenAddress: string; port: number; excludedCidrs: readonly string[] } | undefined;
}

/**
 * 目的: 53番リダイレクトの構成（`dns-redirect-rules`）を照合する。
 * 入力: chains(適用中のテーブルのチェーン), input(現在の状態)。
 * 出力: LAN発の53番宛を中継リゾルバへDNATし、誘導した送信元を記録するルールが、除外宛先を除く形であればpass。
 */
export function auditDnsRedirectRules(chains: Chains | undefined, input: DnsRedirectRulesInput): CheckOutcome {
  const expected = "LANからの53番宛（UDP・TCP）を中継リゾルバへ誘導し、除外する宛先を除いている";
  if (!input.relayActive) {
    return fail(expected, "DNS中継が待受していないため、リダイレクトを構成していない", "「DNS中継の待受」の結果を確認してください。");
  }
  if (input.lanIface === undefined || input.redirect === undefined) {
    return fail(expected, "リダイレクトが構成されていない", RECONFIGURE_HINT);
  }
  if (chains === undefined) return fail(expected, "ゲートウェイのルールのテーブルが無い", RECONFIGURE_HINT);
  const { listenAddress, port, excludedCidrs } = input.redirect;
  const excludedAddresses = [listenAddress, ...excludedCidrs.map((cidr) => cidr.replace(/\/32$/, ""))];
  const found = rules(chains, CHAIN_DNS_REDIRECT).some(
    (line) =>
      line.includes(`iifname "${input.lanIface}"`) &&
      line.includes("th dport 53") &&
      line.includes(`@${REDIRECTED_SET_NAME}`) &&
      line.includes(`dnat ip to ${listenAddress}:${port}`) &&
      excludedAddresses.every((address) => line.includes(address)),
  );
  if (!found) return fail(expected, "誘導のルールが無い、または宛先・除外が設定と異なる", RECONFIGURE_HINT);
  return pass(`53番宛を ${listenAddress}:${port} へ誘導（除外 ${excludedCidrs.length} 件）`);
}

/**
 * 目的: 迂回対象の宛先へ印（fwmark）を付けるルールがあるかを判定する（`bypass-routing`の一部）。
 * 入力: chains(適用中のテーブルのチェーン), lanIface(LAN側インターフェース名)。
 * 出力: LAN発の迂回対象宛に印を付けるルールがあればtrue。
 */
export function hasBypassMarkRule(chains: Chains | undefined, lanIface: string): boolean {
  if (chains === undefined) return false;
  return hasRule(chains, CHAIN_BYPASS_MARK, `iifname "${lanIface}"`, `ip daddr @${BYPASS_SET_NAME}`, "meta mark set");
}
