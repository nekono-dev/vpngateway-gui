// 責務: 設定の動作検証の項目の一覧（ID・項目名・グループ・実行順）と、利用者の設定から導く適用条件。
// 一覧と判定はapiserver/design.md「設定の動作検証」の「検証項目」に対応する。この並び順が実行順・表示順である。

import type { UserSettings } from "../schemas/settings.js";
import type { VerificationGroup } from "../schemas/verification.js";

export interface CheckDefinition {
  id: string;
  title: string;
  group: VerificationGroup;
  // 設定で対象外なら、その理由（利用者向け）。対象ならundefined。
  notApplicableReason: (settings: UserSettings) => string | undefined;
}

const TRANSPARENT_DISABLED = "透過ゲートウェイが無効のため";
const DNS_RELAY_DISABLED = "DNS中継が無効のため";
const EXPLICIT_PROXY_DISABLED = "明示的プロキシが無効のため";

function transparentGateway(settings: UserSettings): string | undefined {
  return settings.transparentGatewayEnabled ? undefined : TRANSPARENT_DISABLED;
}

function dnsRelay(settings: UserSettings): string | undefined {
  return settings.dnsRelayEnabled ? undefined : DNS_RELAY_DISABLED;
}

function dnsRedirect(settings: UserSettings): string | undefined {
  if (!settings.dnsRelayEnabled) return DNS_RELAY_DISABLED;
  return settings.dnsRedirectEnabled ? undefined : "53番リダイレクト（手動でDNSを指定した端末の中継）が無効のため";
}

function bypass(settings: UserSettings): string | undefined {
  if (!settings.dnsRelayEnabled) return DNS_RELAY_DISABLED;
  return settings.excludedDomains.length > 0 ? undefined : "迂回ドメインが登録されていないため";
}

function explicitProxy(settings: UserSettings): string | undefined {
  return settings.explicitProxyEnabled ? undefined : EXPLICIT_PROXY_DISABLED;
}

export const CHECK_DEFINITIONS: readonly CheckDefinition[] = [
  { id: "gateway-rules", title: "透過ゲートウェイの構成", group: "config", notApplicableReason: transparentGateway },
  {
    id: "kill-switch-rules",
    title: "Kill Switch の構成",
    group: "config",
    notApplicableReason: (settings) => transparentGateway(settings) ?? (settings.killSwitch ? undefined : "Kill Switchが無効のため"),
  },
  { id: "dns-relay-listening", title: "DNS中継の待受", group: "config", notApplicableReason: dnsRelay },
  { id: "dns-redirect-rules", title: "53番リダイレクトの構成", group: "config", notApplicableReason: dnsRedirect },
  { id: "explicit-proxy-listening", title: "明示的プロキシの待受", group: "config", notApplicableReason: explicitProxy },
  {
    id: "tunnel-egress",
    title: "VPN トンネルの出口 IP",
    group: "gateway",
    notApplicableReason: (settings) =>
      settings.transparentGatewayEnabled || settings.explicitProxyEnabled ? undefined : "透過ゲートウェイ・明示的プロキシが無効のため",
  },
  { id: "dns-relay-resolve", title: "DNS中継の名前解決", group: "gateway", notApplicableReason: dnsRelay },
  { id: "bypass-set", title: "迂回対象ドメインの登録", group: "gateway", notApplicableReason: bypass },
  { id: "bypass-routing", title: "迂回の経路", group: "gateway", notApplicableReason: bypass },
  { id: "bypass-isolation", title: "迂回対象外ドメインが迂回されないこと", group: "gateway", notApplicableReason: bypass },
  { id: "explicit-proxy-egress", title: "明示的プロキシ経由の出口 IP", group: "gateway", notApplicableReason: explicitProxy },
  { id: "client-egress", title: "この端末の出口 IP", group: "client", notApplicableReason: transparentGateway },
  { id: "dns-redirect-path", title: "53番リダイレクトの通過", group: "client", notApplicableReason: dnsRedirect },
];
