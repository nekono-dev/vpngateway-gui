// 責務: 設定反映リクエストの検証・変換（settings-request.ts）の単体テスト。

import { describe, expect, it } from "vitest";
import { parseSettingsRequest, toDnsRelaySettings, toGatewayDnsSettings } from "./settings-request.js";

const LEGACY = {
  killSwitch: true,
  transparentGatewayEnabled: true,
  explicitProxyEnabled: false,
  explicitProxyAllowedCidrs: [] as string[],
};

describe("parseSettingsRequest", () => {
  it("Phase 14より前の形状（DNS関連の項目なし）は、既定値（無効・空）で補って受理する", () => {
    const body = parseSettingsRequest(LEGACY);
    expect(body).toMatchObject({ dnsClientNameServers: [], excludedDomains: [], dnsRelayEnabled: false, dnsUpstreamUrl: "", dnsFailureMode: "failClosed", dnsRedirectEnabled: false });
  });

  it("必須項目の型が違う・オブジェクトでない入力は拒否する", () => {
    expect(parseSettingsRequest(null)).toBeUndefined();
    expect(parseSettingsRequest({ ...LEGACY, killSwitch: "yes" })).toBeUndefined();
    expect(parseSettingsRequest({ ...LEGACY, explicitProxyAllowedCidrs: [1] })).toBeUndefined();
  });

  it("DNS関連の項目が指定されていて型が違う場合は拒否する", () => {
    expect(parseSettingsRequest({ ...LEGACY, dnsFailureMode: "open" })).toBeUndefined();
    expect(parseSettingsRequest({ ...LEGACY, excludedDomains: "example.com" })).toBeUndefined();
    expect(parseSettingsRequest({ ...LEGACY, dnsRelayEnabled: 1 })).toBeUndefined();
    expect(parseSettingsRequest({ ...LEGACY, dnsFallbackServers: [1] })).toBeUndefined();
    expect(parseSettingsRequest({ ...LEGACY, dnsClientNameServers: "192.168.3.254" })).toBeUndefined();
  });
});

describe("toGatewayDnsSettings", () => {
  const relay = { ...LEGACY, dnsRelayEnabled: true, excludedDomains: ["example.com"], dnsRedirectEnabled: true, dnsRedirectExcludedCidrs: ["10.0.0.0/8", "bad"] };

  it("DNS中継が有効で、有効な迂回ドメインがあれば迂回を有効にする", () => {
    expect(toGatewayDnsSettings(parseSettingsRequest(relay)!, "192.168.3.240", 53, true).bypassEnabled).toBe(true);
  });

  it("DNS中継が無効、または迂回ドメインが無い（不正な表記のみ含む）なら迂回は無効", () => {
    expect(toGatewayDnsSettings(parseSettingsRequest({ ...relay, dnsRelayEnabled: false })!, "192.168.3.240", 53, true).bypassEnabled).toBe(false);
    expect(toGatewayDnsSettings(parseSettingsRequest({ ...relay, excludedDomains: [] })!, "192.168.3.240", 53, true).bypassEnabled).toBe(false);
    expect(toGatewayDnsSettings(parseSettingsRequest({ ...relay, excludedDomains: ["bad domain"] })!, "192.168.3.240", 53, true).bypassEnabled).toBe(false);
  });

  it("53番リダイレクト: 有効かつLAN側アドレスが分かるときだけ構成し、不正な除外CIDRは取り除く", () => {
    expect(toGatewayDnsSettings(parseSettingsRequest(relay)!, "192.168.3.240", 5353, true).redirect).toEqual({
      listenAddress: "192.168.3.240",
      port: 5353,
      excludedCidrs: ["10.0.0.0/8"],
    });
    expect(toGatewayDnsSettings(parseSettingsRequest(relay)!, undefined, 53, true).redirect).toBeUndefined();
    expect(toGatewayDnsSettings(parseSettingsRequest({ ...relay, dnsRedirectEnabled: false })!, "192.168.3.240", 53, true).redirect).toBeUndefined();
    expect(toGatewayDnsSettings(parseSettingsRequest({ ...relay, dnsRelayEnabled: false })!, "192.168.3.240", 53, false).redirect).toBeUndefined();
  });

  it("中継リゾルバが待受中でない間は、リダイレクトしない（手動でDNSを指定した端末の名前解決を止めないため）。迂回の構成は妨げない", () => {
    const settings = toGatewayDnsSettings(parseSettingsRequest(relay)!, "192.168.3.240", 53, false);
    expect(settings.redirect).toBeUndefined();
    expect(settings.bypassEnabled).toBe(true);
  });
});

describe("toDnsRelaySettings", () => {
  it("項目名を対応づけて渡す", () => {
    const body = parseSettingsRequest({ ...LEGACY, dnsRelayEnabled: true, dnsUpstreamUrl: "https://x/dns-query", dnsFailureMode: "fallback", dnsFallbackServers: ["1.1.1.1"] })!;
    expect(toDnsRelaySettings(body)).toMatchObject({ enabled: true, upstreamUrl: "https://x/dns-query", failureMode: "fallback", fallbackServers: ["1.1.1.1"] });
  });
});
