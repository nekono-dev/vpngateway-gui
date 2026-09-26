// 責務: 設定の動作検証のうち、ゲートウェイで実行する項目（L1: 構成の照合、L2: ゲートウェイ内での通信・名前解決）を、
// 項目IDごとに実行して結果を返す（`POST /net/checks`）。ゲートウェイの設定・状態は変更しない（読み取りと、検証用の
// 問い合わせ・通信のみ）。項目の一覧・判定はapiserver/design.md「設定の動作検証」、実装はproxyserver/design.md「設定の動作検証」。
// nft・ip・curl・中継リゾルバへの問い合わせ等の実行環境への依存は、GatewayCheckDependenciesとして注入する（単体テストのため）。

import { isIpv4InCidr } from "../lib/ipv4-cidr.js";
import { BYPASS_FWMARK, BYPASS_SET_NAME } from "../network/ruleset.js";
import { isBypassableAddress } from "../network/bypass-set.js";
import type { GatewayVerificationState } from "../network/gateway-controller.js";
import type { DnsRelaySettings, DnsRelayStatus } from "../dns-relay/dns-relay-controller.js";
import { createDomainMatcher } from "../dns-relay/domain-matcher.js";
import type { DnsAnswer } from "../dns-relay/dns-message.js";
import { SELF_CHECK_CLIENT_ID } from "../dns-relay/client-id.js";
import type { ExplicitProxyStatus } from "../explicit-proxy/explicit-proxy-controller.js";
import { fail, pass, unconfirmed, type CheckOutcome, type GatewayCheckId } from "./check-outcome.js";
import type { EgressResult, EgressRoute } from "./egress-probe.js";
import type { SetElement } from "./nft-listing.js";
import { auditDnsRedirectRules, auditGatewayRules, auditKillSwitchRules, hasBypassMarkRule } from "./rule-audit.js";

export interface GatewayCheckRequest {
  check: GatewayCheckId;
  // IP確認サービスのURL（利用者の設定`verifyEchoUrl`）。
  echoUrl: string;
  // VPNトンネルの出口IP（`tunnel-egress`の結果）。`explicit-proxy-egress`の比較に使う。
  expectedEgressIp?: string;
  // 迂回対象として登録されたIP（`bypass-set`の結果）。`bypass-routing`で経路を確かめる。
  bypassProbeIp?: string;
}

export interface GatewayCheckDependencies {
  gatewayState(): GatewayVerificationState;
  relay(): { status: DnsRelayStatus; settings: DnsRelaySettings; port: number; listenAddresses: readonly string[] };
  explicitProxy(): { status: ExplicitProxyStatus; allowedCidrs: readonly string[] };
  // ゲートウェイのLAN側アドレス（明示的プロキシへ、許可元に含まれうるアドレスから接続するために使う）。
  lanAddress: string | undefined;
  // 適用中のテーブルのチェーン。テーブルが無ければundefined。
  listTable(): Promise<ReadonlyMap<string, readonly string[]> | undefined>;
  // setの要素。setが無ければundefined。
  listSet(name: string): Promise<SetElement[] | undefined>;
  ipForwardEnabled(): boolean;
  routeInterface(address: string, fwmark?: number): Promise<string | undefined>;
  fetchEgress(url: string, route: EgressRoute): Promise<EgressResult>;
  queryRelay(name: string, port: number): Promise<DnsAnswer | undefined>;
  tcpReachable(host: string, port: number): Promise<boolean>;
}

const RELAY_NOT_ACTIVE = "DNS中継が待受していないため、問い合わせできません（「DNS中継の待受」を参照）。";
const VPN_NOT_CONNECTED = "VPNが未接続のため、確認できません。";
const VPN_NOT_CONNECTED_HINT = "VPNに接続してから、もう一度実行してください。";
// 迂回されないことを確かめる対照のドメイン（迂回ドメインに含まれないものを先頭から選ぶ）。
const CONTROL_DOMAINS = ["example.com", "example.net", "example.org"];
// `bypass-set`で試す迂回ドメインの数の上限。
const MAX_BYPASS_CANDIDATES = 3;

function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    return /^[\d.]+$/.test(host) ? undefined : host;
  } catch {
    return undefined;
  }
}

/**
 * 目的: 迂回ドメインの表記から、問い合わせに使う名前を作る。
 * 入力: pattern(`example.com`または`*.example.com`)。
 * 出力: 完全一致はそのまま、ワイルドカードは`www.`を付けた名前。
 */
export function probeNameFor(pattern: string): string {
  return pattern.startsWith("*.") ? `www.${pattern.slice(2)}` : pattern;
}

function bypassableAddresses(answer: DnsAnswer | undefined): string[] {
  if (answer === undefined || answer.rcode !== 0) return [];
  return answer.aRecords.map((record) => record.address).filter((address) => isBypassableAddress(address));
}

async function checkGatewayRules(deps: GatewayCheckDependencies, killSwitchOnly: boolean): Promise<CheckOutcome> {
  const state = deps.gatewayState();
  const input = {
    lanIface: state.lanIface,
    wanIface: state.wanIface,
    vpnIface: state.vpnIface,
    killSwitch: state.settings.killSwitch,
    ipForwardEnabled: deps.ipForwardEnabled(),
  };
  const chains = await deps.listTable();
  return killSwitchOnly ? auditKillSwitchRules(chains, input) : auditGatewayRules(chains, input);
}

function checkRelayListening(deps: GatewayCheckDependencies): CheckOutcome {
  const { status, port, listenAddresses } = deps.relay();
  if (status.state === "active") {
    return pass(`${listenAddresses.map((address) => `${address}:${port}`).join("・")} で待受中（UDP・TCP）`);
  }
  const expected = "中継リゾルバがLAN側アドレスと127.0.0.1で待受している";
  if (status.state === "unconfigured") {
    return fail(expected, "自宅DNSサーバ・切り替え先の公開DNSが未設定", "「上位DNSリゾルバ」タブで自宅DNSサーバのURLを設定してください。");
  }
  if (status.state === "error") {
    return fail(
      expected,
      `待受に失敗（ポート${port}の衝突等）`,
      "ホストの他のDNSサーバ（systemd-resolved等）が同じポートを使っていないか確認してください（DNS_RELAY_PORTで変更できます）。",
    );
  }
  return fail(expected, "停止中", "設定を保存し直してください。");
}

async function checkRedirectRules(deps: GatewayCheckDependencies): Promise<CheckOutcome> {
  const state = deps.gatewayState();
  return auditDnsRedirectRules(await deps.listTable(), {
    lanIface: state.lanIface,
    relayActive: deps.relay().status.state === "active",
    redirect: state.settings.dns?.redirect,
  });
}

async function checkExplicitProxyListening(deps: GatewayCheckDependencies): Promise<CheckOutcome> {
  const { status } = deps.explicitProxy();
  const expected = "明示的プロキシ（3proxy）が稼働し、SOCKS5・HTTPのポートで待受している";
  if (status.state !== "active" || status.socksPort === undefined || status.httpPort === undefined) {
    const observed: Record<string, string> = {
      stopped: "停止中",
      unconfigured: "許可元CIDRが未設定",
      crashLoop: "異常終了を繰り返している",
      error: "設定ファイルを生成できない",
    };
    return fail(expected, observed[status.state] ?? status.state, "「ゲートウェイ」タブの設定と、ゲートウェイのログ（explicit_proxy_*）を確認してください。");
  }
  const host = deps.lanAddress ?? "127.0.0.1";
  const [socks, http] = await Promise.all([deps.tcpReachable(host, status.socksPort), deps.tcpReachable(host, status.httpPort)]);
  if (!socks || !http) {
    const closed = [...(socks ? [] : [`SOCKS5（${status.socksPort}）`]), ...(http ? [] : [`HTTP（${status.httpPort}）`])];
    return fail(expected, `${closed.join("・")}に接続できない`, "ゲートウェイのログ（explicit_proxy_*）を確認してください。");
  }
  return pass(`SOCKS5（${status.socksPort}）・HTTP（${status.httpPort}）で待受中`);
}

async function checkTunnelEgress(deps: GatewayCheckDependencies, echoUrl: string): Promise<CheckOutcome> {
  const { vpnIface } = deps.gatewayState();
  if (vpnIface === undefined) return unconfirmed(VPN_NOT_CONNECTED, VPN_NOT_CONNECTED_HINT);
  const result = await deps.fetchEgress(echoUrl, { interface: vpnIface });
  if (!result.ok) {
    return fail(
      "VPNトンネル経由で、IP確認サービスから出口IPを取得できる",
      result.error,
      "VPNの接続状態と、IP確認サービスのURL（応答本文がIPv4アドレスのみのサービス）を確認してください。",
    );
  }
  return pass(`${result.ip}（${vpnIface} 経由）`, result.ip);
}

async function checkRelayResolve(deps: GatewayCheckDependencies, echoUrl: string): Promise<CheckOutcome> {
  const relay = deps.relay();
  if (relay.status.state !== "active") return unconfirmed(RELAY_NOT_ACTIVE);
  const name = hostOf(echoUrl) ?? CONTROL_DOMAINS[0];
  const answer = await deps.queryRelay(name, relay.port);
  const expected = "中継リゾルバが問い合わせに応答し、自宅DNSサーバへ転送できる";
  if (answer === undefined) {
    return fail(expected, `${name} の問い合わせに応答が無い（タイムアウト）`, "ゲートウェイのログ（dns_relay_*）を確認してください。");
  }
  if (answer.rcode !== 0 && answer.rcode !== 3) {
    return fail(
      expected,
      `${name} の問い合わせにエラー応答（RCODE ${answer.rcode}）`,
      "自宅DNSサーバ（DoHのURL・証明書）に接続できるか確認してください。",
    );
  }
  const upstreamConfigured = relay.settings.upstreamUrl.length > 0;
  if (upstreamConfigured && deps.relay().status.upstream !== "ok") {
    return fail(
      expected,
      "自宅DNSサーバへの転送に失敗し、切り替え先の公開DNSで応答した",
      "自宅DNSサーバ（DoHのURL・証明書）に接続できるか確認してください。",
    );
  }
  return pass(
    upstreamConfigured
      ? `${name} の問い合わせに応答（自宅DNSサーバ経由。ClientID: ${SELF_CHECK_CLIENT_ID}）`
      : `${name} の問い合わせに応答（切り替え先の公開DNS経由）`,
  );
}

async function checkBypassSet(deps: GatewayCheckDependencies): Promise<CheckOutcome> {
  const relay = deps.relay();
  if (relay.status.state !== "active") return unconfirmed(RELAY_NOT_ACTIVE);
  const names = relay.settings.excludedDomains.map((pattern) => probeNameFor(pattern)).slice(0, MAX_BYPASS_CANDIDATES);
  if (names.length === 0) return unconfirmed("迂回ドメインが登録されていません。");
  for (const name of names) {
    const addresses = bypassableAddresses(await deps.queryRelay(name, relay.port));
    if (addresses.length === 0) continue;
    const elements = await deps.listSet(BYPASS_SET_NAME);
    const expected = `${name} の名前解決結果（IPv4）が迂回対象に登録される`;
    if (elements === undefined) {
      return fail(expected, "迂回対象を登録するsetが無い", "設定を保存し直すと、ルールが再構成されます。");
    }
    const registered = addresses.filter((address) => elements.some((element) => element.address === address));
    if (registered.length === 0) {
      return fail(expected, `${addresses.join(", ")} が迂回対象に無い`, "ゲートウェイのログ（bypass_set_update_error）を確認してください。");
    }
    const others = addresses.length > 1 ? `（ほか ${addresses.length - 1} 件）` : "";
    return pass(`${name} → ${registered[0]}${others} を迂回対象に登録`, registered[0]);
  }
  return unconfirmed(
    `迂回ドメイン（${names.join(", ")}）の名前解決結果（IPv4）が得られません。`,
    "名前解決できる迂回ドメインがあるか、自宅DNSサーバでブロックされていないか確認してください。",
  );
}

async function checkBypassRouting(deps: GatewayCheckDependencies, bypassProbeIp: string | undefined): Promise<CheckOutcome> {
  if (bypassProbeIp === undefined) {
    return unconfirmed("迂回対象のIPが得られなかったため、経路を確認できません（「迂回対象ドメインの登録」を参照）。");
  }
  const { lanIface, wanIface, vpnIface } = deps.gatewayState();
  const wan = wanIface ?? lanIface;
  const expected = `迂回対象（${bypassProbeIp}）宛の通信に印を付け、実回線（${wan ?? "LAN側"}）へ送る`;
  if (lanIface === undefined || wan === undefined) {
    return fail(expected, "LAN側インターフェースが未設定", "インストーラを実行し、LAN側インターフェースを設定してください。");
  }
  if (!hasBypassMarkRule(await deps.listTable(), lanIface)) {
    return fail(expected, "迂回対象の宛先に印を付けるルールが無い", "設定を保存し直すと、ルールが再構成されます。");
  }
  const markedIface = await deps.routeInterface(bypassProbeIp, BYPASS_FWMARK);
  if (markedIface !== wan) {
    return fail(
      expected,
      `印を付けた通信が ${markedIface ?? "（経路なし）"} へ出る`,
      "迂回用の経路（ip rule・テーブル100）が外れています。設定を保存し直すか、ゲートウェイのログ（bypass_routing_error）を確認してください。",
    );
  }
  if (vpnIface === undefined) return pass(`迂回: ${wan}（実回線）。VPN未接続のため、印の無い通信の経路は比較していません`);
  const plainIface = await deps.routeInterface(bypassProbeIp);
  if (plainIface !== vpnIface) {
    return fail(
      `印の無い通信はVPNトンネル（${vpnIface}）へ送る`,
      `印の無い通信が ${plainIface ?? "（経路なし）"} へ出る`,
      "VPNの経路が変わっています。VPNに接続し直してください。",
    );
  }
  return pass(`迂回: ${wan}（実回線）、印なし: ${vpnIface}（VPN）`);
}

async function checkBypassIsolation(deps: GatewayCheckDependencies): Promise<CheckOutcome> {
  const relay = deps.relay();
  if (relay.status.state !== "active") return unconfirmed(RELAY_NOT_ACTIVE);
  const matcher = createDomainMatcher(relay.settings.excludedDomains);
  const name = CONTROL_DOMAINS.find((domain) => !matcher(domain));
  if (name === undefined) return unconfirmed("対照に使うドメインが、すべて迂回ドメインに含まれています。");
  const before = await deps.listSet(BYPASS_SET_NAME);
  if (before === undefined) return unconfirmed("迂回対象を登録するsetが無いため、確認できません（「迂回対象ドメインの登録」を参照）。");
  const addresses = bypassableAddresses(await deps.queryRelay(name, relay.port));
  if (addresses.length === 0) return unconfirmed(`対照のドメイン（${name}）の名前解決結果（IPv4）が得られません。`);
  const fresh = addresses.filter((address) => !before.some((element) => element.address === address));
  if (fresh.length === 0) {
    return unconfirmed(`対照のドメイン（${name}）のIPが、迂回ドメインのIPと共有されているため、確認できません。`);
  }
  const after = (await deps.listSet(BYPASS_SET_NAME)) ?? [];
  const leaked = fresh.filter((address) => after.some((element) => element.address === address));
  if (leaked.length > 0) {
    return fail(
      `迂回ドメインではない ${name} は、迂回対象に登録されない`,
      `${leaked.join(", ")} が迂回対象に登録された`,
      "迂回ドメインの一覧に、意図しない表記（ワイルドカード等）が無いか確認してください。",
    );
  }
  return pass(`迂回ドメインではない ${name} は、迂回対象に登録されない`);
}

async function checkExplicitProxyEgress(deps: GatewayCheckDependencies, request: GatewayCheckRequest): Promise<CheckOutcome> {
  const { vpnIface } = deps.gatewayState();
  if (vpnIface === undefined) return unconfirmed(VPN_NOT_CONNECTED, VPN_NOT_CONNECTED_HINT);
  const { status, allowedCidrs } = deps.explicitProxy();
  if (status.state !== "active" || status.socksPort === undefined || status.httpPort === undefined) {
    return unconfirmed("明示的プロキシが稼働していないため、確認できません（「明示的プロキシの待受」を参照）。");
  }
  const lanAddress = deps.lanAddress;
  if (lanAddress === undefined) return unconfirmed("ゲートウェイのLAN側アドレスが分からないため、確認できません。");
  if (!allowedCidrs.some((cidr) => isIpv4InCidr(lanAddress, cidr))) {
    return unconfirmed(
      `ゲートウェイ自身（${lanAddress}）が許可元CIDRに含まれないため、確認できません。`,
      "許可元CIDRにLAN全体（ゲートウェイを含む範囲）を指定すると確認できます。",
    );
  }
  const expectedIp = request.expectedEgressIp;
  if (expectedIp === undefined) return unconfirmed("VPNトンネルの出口IPが得られなかったため、比較できません（「VPNトンネルの出口IP」を参照）。");
  const [socks, http] = await Promise.all([
    deps.fetchEgress(request.echoUrl, { proxy: `socks5h://${lanAddress}:${status.socksPort}` }),
    deps.fetchEgress(request.echoUrl, { proxy: `http://${lanAddress}:${status.httpPort}` }),
  ]);
  const describe = (result: EgressResult): string => (result.ok ? result.ip : `取得失敗（${result.error}）`);
  const expected = `SOCKS5・HTTPの両方の出口IPが、VPNの出口（${expectedIp}）と一致する`;
  const observed = `SOCKS5: ${describe(socks)}、HTTP: ${describe(http)}`;
  if (!socks.ok || !http.ok) {
    return fail(expected, observed, "ゲートウェイのログ（explicit_proxy_*）と、IP確認サービスのURLを確認してください。");
  }
  if (socks.ip !== expectedIp || http.ip !== expectedIp) {
    return fail(expected, observed, "明示的プロキシの通信がVPNを経由していません。VPNに接続し直してください。");
  }
  return pass(`SOCKS5・HTTPとも ${expectedIp}（VPNの出口と一致）`);
}

/**
 * 目的: 検証項目を1つ実行する。
 * 入力: request(項目ID・IP確認サービスのURL・前の項目の結果), deps(実行環境)。
 * 出力: 結果。
 * 失敗時の方針: 実行中の例外は、不合格ではなく未確認（理由に例外の内容）として返す。
 */
export async function runGatewayCheck(request: GatewayCheckRequest, deps: GatewayCheckDependencies): Promise<CheckOutcome> {
  try {
    switch (request.check) {
      case "gateway-rules":
        return await checkGatewayRules(deps, false);
      case "kill-switch-rules":
        return await checkGatewayRules(deps, true);
      case "dns-relay-listening":
        return checkRelayListening(deps);
      case "dns-redirect-rules":
        return await checkRedirectRules(deps);
      case "explicit-proxy-listening":
        return await checkExplicitProxyListening(deps);
      case "tunnel-egress":
        return await checkTunnelEgress(deps, request.echoUrl);
      case "dns-relay-resolve":
        return await checkRelayResolve(deps, request.echoUrl);
      case "bypass-set":
        return await checkBypassSet(deps);
      case "bypass-routing":
        return await checkBypassRouting(deps, request.bypassProbeIp);
      case "bypass-isolation":
        return await checkBypassIsolation(deps);
      case "explicit-proxy-egress":
        return await checkExplicitProxyEgress(deps, request);
    }
  } catch (error) {
    return unconfirmed(`確認中にエラーが発生しました（${error instanceof Error ? error.message : String(error)}）。`);
  }
}
