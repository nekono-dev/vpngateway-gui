// 責務: `POST /net/settings`のリクエストボディの検証と、各コントローラへ渡す設定への変換（純粋関数）。
// 内部プロトコルの形状はapiserver/design.md「設定反映（`POST /settings`）内部プロトコル仕様」、変換規則は
// proxyserver/design.md「ドメイン迂回とDNS中継」「設定の反映と状態」に対応する。

import { isIpv4Cidr } from "./lib/ipv4-cidr.js";
import { sanitizeExcludedDomains, type DnsRelaySettings } from "./dns-relay/dns-relay-controller.js";
import type { GatewayDnsSettings } from "./network/gateway-controller.js";

export interface SettingsRequestBody {
  killSwitch: boolean;
  transparentGatewayEnabled: boolean;
  explicitProxyEnabled: boolean;
  explicitProxyAllowedCidrs: string[];
  excludedDomains: string[];
  dnsRelayEnabled: boolean;
  dnsUpstreamUrl: string;
  dnsUpstreamCaPem: string;
  dnsFailureMode: "failClosed" | "fallback";
  dnsFallbackServers: string[];
  dnsClientNameServers: string[];
  dnsRedirectEnabled: boolean;
  dnsRedirectExcludedCidrs: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * 目的: unknownな入力(JSON.parseの結果)を検証し、省略された項目を既定値で補ったボディを返す。
 * 入力: value(JSON.parse()の戻り値)。
 * 出力: 検証済みのボディ。形状が不正ならundefined。
 * 期待する入力形状: killSwitch/transparentGatewayEnabled/explicitProxyEnabledがboolean、explicitProxyAllowedCidrsが
 *                文字列配列。Phase 14で加わったexcludedDomains・dns*は省略可（省略時は無効・空）で、指定されていれば型が一致すること。
 *                個々のCIDR・ドメインの形式はここでは検証しない（利用側で検証する）。
 */
export function parseSettingsRequest(value: unknown): SettingsRequestBody | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const body = value as Record<string, unknown>;
  if (
    typeof body.killSwitch !== "boolean" ||
    typeof body.transparentGatewayEnabled !== "boolean" ||
    typeof body.explicitProxyEnabled !== "boolean" ||
    !isStringArray(body.explicitProxyAllowedCidrs)
  ) {
    return undefined;
  }
  const excludedDomains = body.excludedDomains ?? [];
  const dnsRelayEnabled = body.dnsRelayEnabled ?? false;
  const dnsUpstreamUrl = body.dnsUpstreamUrl ?? "";
  const dnsUpstreamCaPem = body.dnsUpstreamCaPem ?? "";
  const dnsFailureMode = body.dnsFailureMode ?? "failClosed";
  const dnsFallbackServers = body.dnsFallbackServers ?? [];
  const dnsClientNameServers = body.dnsClientNameServers ?? [];
  const dnsRedirectEnabled = body.dnsRedirectEnabled ?? false;
  const dnsRedirectExcludedCidrs = body.dnsRedirectExcludedCidrs ?? [];
  if (
    !isStringArray(excludedDomains) ||
    typeof dnsRelayEnabled !== "boolean" ||
    typeof dnsUpstreamUrl !== "string" ||
    typeof dnsUpstreamCaPem !== "string" ||
    (dnsFailureMode !== "failClosed" && dnsFailureMode !== "fallback") ||
    !isStringArray(dnsFallbackServers) ||
    !isStringArray(dnsClientNameServers) ||
    typeof dnsRedirectEnabled !== "boolean" ||
    !isStringArray(dnsRedirectExcludedCidrs)
  ) {
    return undefined;
  }
  return {
    killSwitch: body.killSwitch,
    transparentGatewayEnabled: body.transparentGatewayEnabled,
    explicitProxyEnabled: body.explicitProxyEnabled,
    explicitProxyAllowedCidrs: body.explicitProxyAllowedCidrs,
    excludedDomains,
    dnsRelayEnabled,
    dnsUpstreamUrl,
    dnsUpstreamCaPem,
    dnsFailureMode,
    dnsFallbackServers,
    dnsClientNameServers,
    dnsRedirectEnabled,
    dnsRedirectExcludedCidrs,
  };
}

/** 目的: DNS中継コントローラへ渡す設定へ変換する。 */
export function toDnsRelaySettings(body: SettingsRequestBody): DnsRelaySettings {
  return {
    enabled: body.dnsRelayEnabled,
    excludedDomains: body.excludedDomains,
    upstreamUrl: body.dnsUpstreamUrl,
    upstreamCaPem: body.dnsUpstreamCaPem,
    failureMode: body.dnsFailureMode,
    fallbackServers: body.dnsFallbackServers,
    clientNameServers: body.dnsClientNameServers,
  };
}

/**
 * 目的: ゲートウェイ（nft・ポリシールーティング）へ渡すDNS関連の設定へ変換する。
 * 入力: body(検証済みのボディ), listenAddress(中継リゾルバのLAN側の待受アドレス。不明ならundefined), port(待受ポート),
 *      relayActive(中継リゾルバが実際に待受中か)。
 * 出力: 迂回は「DNS中継が有効で、有効な迂回ドメインが1件以上」のときのみ有効にする。53番リダイレクトは
 *      「中継リゾルバが待受中でリダイレクトが有効、かつ宛先のLAN側アドレスが分かる」ときのみ構成する
 *      （待受に失敗している間にリダイレクトすると、手動でDNSを指定した端末の名前解決まで止まるため。
 *      除外CIDRのうち形式が不正なものは取り除く）。
 */
export function toGatewayDnsSettings(
  body: SettingsRequestBody,
  listenAddress: string | undefined,
  port: number,
  relayActive: boolean,
): GatewayDnsSettings {
  const bypassEnabled = body.dnsRelayEnabled && sanitizeExcludedDomains(body.excludedDomains).length > 0;
  const redirect =
    relayActive && body.dnsRedirectEnabled && listenAddress !== undefined
      ? {
          listenAddress,
          port,
          excludedCidrs: body.dnsRedirectExcludedCidrs.filter((cidr) => isIpv4Cidr(cidr)),
        }
      : undefined;
  return { bypassEnabled, redirect };
}
