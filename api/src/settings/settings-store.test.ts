// 責務: ユーザ向け設定ストアの読み込み互換性（廃止項目の無視・不足項目のデフォルト補完）の単体テスト。

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const file = join(mkdtempSync(join(tmpdir(), "vpngwgui-settings-")), "settings.json");
process.env.SETTINGS_FILE = file;

const { getSettings, updateSettings, SettingsValidationError } = await import("./settings-store.js");

describe("settings-store", () => {
  it("Phase 8で廃止したdefaultCountryが保存ファイルに残っていても、読み込みで無視する", () => {
    writeFileSync(file, JSON.stringify({ killSwitch: false, defaultCountry: "jp", excludedDomains: ["example.com"] }));
    const settings = getSettings();
    expect(settings).not.toHaveProperty("defaultCountry");
    expect(settings.killSwitch).toBe(false);
    expect(settings.excludedDomains).toEqual(["example.com"]);
    // 保存ファイルに無い項目はデフォルト値で補う（透過ゲートウェイはデフォルト有効）
    expect(settings.transparentGatewayEnabled).toBe(true);
  });

  it("透過ゲートウェイ・明示的プロキシの両方を無効にする更新は拒否し、保存済みの値を変えない", () => {
    updateSettings({ transparentGatewayEnabled: true, explicitProxyEnabled: false });
    expect(() => updateSettings({ transparentGatewayEnabled: false, explicitProxyEnabled: false })).toThrow(SettingsValidationError);
    expect(getSettings().transparentGatewayEnabled).toBe(true);
  });

  it("更新すると、廃止項目は保存ファイルからも消える", () => {
    writeFileSync(file, JSON.stringify({ killSwitch: true, defaultCountry: "jp" }));
    updateSettings({ killSwitch: false });
    expect(JSON.parse(readFileSync(file, "utf8"))).not.toHaveProperty("defaultCountry");
  });

  it("explicitProxyAllowedCidrsにIPv4 CIDRを保存できる", () => {
    const next = updateSettings({ explicitProxyAllowedCidrs: ["192.168.3.0/24", "10.0.0.0/8"] });
    expect(next.explicitProxyAllowedCidrs).toEqual(["192.168.3.0/24", "10.0.0.0/8"]);
    expect(getSettings().explicitProxyAllowedCidrs).toEqual(["192.168.3.0/24", "10.0.0.0/8"]);
  });

  it.each(["192.168.3.0", "192.168.3.0/33", "fe80::/64", "192.168.3.0/24\nallow * 0.0.0.0/0", "example.com"])(
    "explicitProxyAllowedCidrsに不正な値 %j を含む更新は拒否し、保存済みの値を変えない",
    (invalid) => {
      updateSettings({ explicitProxyAllowedCidrs: ["192.168.3.0/24"] });
      expect(() => updateSettings({ explicitProxyAllowedCidrs: ["10.0.0.0/8", invalid] })).toThrow(SettingsValidationError);
      expect(getSettings().explicitProxyAllowedCidrs).toEqual(["192.168.3.0/24"]);
    },
  );

  describe("excludedDomains（Phase 14）", () => {
    it("完全一致（example.com）とワイルドカード（*.example.com）の両方の表記を保存できる", () => {
      const next = updateSettings({ excludedDomains: ["example.com", "*.example.com", "*.a.example.co.jp"] });
      expect(next.excludedDomains).toEqual(["example.com", "*.example.com", "*.a.example.co.jp"]);
    });

    it.each(["*", "*.com.*", "a*.example.com", "**.example.com", "example.com/path", "localhost", "exa mple.com", "example.com\nallow", "*."])(
      "不正な表記 %j を含む更新は拒否し、保存済みの値を変えない",
      (invalid) => {
        updateSettings({ excludedDomains: ["example.com"] });
        expect(() => updateSettings({ excludedDomains: ["example.org", invalid] })).toThrow(SettingsValidationError);
        expect(getSettings().excludedDomains).toEqual(["example.com"]);
      },
    );

    it("件数の上限（200件）を超える更新は拒否する", () => {
      const many = Array.from({ length: 201 }, (_, index) => `d${index}.example.com`);
      expect(() => updateSettings({ excludedDomains: many })).toThrow(SettingsValidationError);
    });
  });

  describe("DNS中継（Phase 14）", () => {
    const valid = { dnsRelayEnabled: true, dnsUpstreamUrl: "https://dns.home.example/dns-query" };
    const CERT = "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUAAAA\n-----END CERTIFICATE-----\n";

    it("既定値は無効・フェイルクローズ・空", () => {
      writeFileSync(file, JSON.stringify({ killSwitch: true }));
      expect(getSettings()).toMatchObject({
        dnsRelayEnabled: false,
        dnsUpstreamUrl: "",
        dnsUpstreamCaPem: "",
        dnsFailureMode: "failClosed",
        dnsFallbackServers: [],
        dnsRedirectEnabled: false,
        dnsRedirectExcludedCidrs: [],
      });
    });

    it("正しい設定を保存できる（上流・CA・フォールバック・リダイレクト）", () => {
      const next = updateSettings({
        ...valid,
        dnsUpstreamCaPem: CERT,
        dnsFailureMode: "fallback",
        dnsFallbackServers: ["1.1.1.1", "9.9.9.9"],
        dnsRedirectEnabled: true,
        dnsRedirectExcludedCidrs: ["192.168.3.5/32"],
      });
      expect(next).toMatchObject({ dnsRelayEnabled: true, dnsFailureMode: "fallback", dnsFallbackServers: ["1.1.1.1", "9.9.9.9"] });
    });

    it.each([
      "http://dns.home.example/dns-query",
      "https://user:pass@dns.home.example/dns-query",
      "https://dns.home.example/dns-query?x=1",
      "https://dns.home.example/dns-query#frag",
      "dns.home.example",
      "ftp://dns.home.example/",
    ])("dnsUpstreamUrlに不正な値 %j を含む更新は拒否する", (invalid) => {
      expect(() => updateSettings({ dnsUpstreamUrl: invalid })).toThrow(SettingsValidationError);
    });

    it("dnsUpstreamCaPemはPEM形式の証明書のみ許可する", () => {
      expect(() => updateSettings({ dnsUpstreamCaPem: "not a pem" })).toThrow(SettingsValidationError);
      expect(() => updateSettings({ dnsUpstreamCaPem: `${CERT}\nextra` })).toThrow(SettingsValidationError);
      expect(() => updateSettings({ dnsUpstreamCaPem: "-----BEGIN CERTIFICATE-----\n" + "A".repeat(20000) + "\n-----END CERTIFICATE-----" })).toThrow(SettingsValidationError);
    });

    it("dnsFallbackServersはIPv4アドレスのみ・最大3件", () => {
      expect(() => updateSettings({ dnsFallbackServers: ["dns.google"] })).toThrow(SettingsValidationError);
      expect(() => updateSettings({ dnsFallbackServers: ["1.1.1.1/32"] })).toThrow(SettingsValidationError);
      expect(() => updateSettings({ dnsFallbackServers: ["1.1.1.1", "8.8.8.8", "9.9.9.9", "8.8.4.4"] })).toThrow(SettingsValidationError);
    });

    it("dnsRedirectExcludedCidrsはIPv4 CIDRのみ（改行等による注入を拒否）", () => {
      expect(() => updateSettings({ dnsRedirectExcludedCidrs: ["10.0.0.0"] })).toThrow(SettingsValidationError);
      expect(() => updateSettings({ dnsRedirectExcludedCidrs: ["10.0.0.0/8\nflush ruleset"] })).toThrow(SettingsValidationError);
    });

    it("DNS中継を有効にするには、上流URLかフォールバック先が必要", () => {
      writeFileSync(file, JSON.stringify({ killSwitch: true }));
      expect(() => updateSettings({ dnsRelayEnabled: true })).toThrow(SettingsValidationError);
      expect(updateSettings({ dnsRelayEnabled: true, dnsFallbackServers: ["1.1.1.1"] }).dnsRelayEnabled).toBe(true);
    });

    it("フォールバックを選ぶには、フォールバック先が必要", () => {
      writeFileSync(file, JSON.stringify({ killSwitch: true }));
      expect(() => updateSettings({ dnsFailureMode: "fallback" })).toThrow(SettingsValidationError);
      expect(updateSettings({ dnsFailureMode: "fallback", dnsFallbackServers: ["1.1.1.1"] }).dnsFailureMode).toBe("fallback");
    });

    it("拒否された更新は、保存済みの値を変えない", () => {
      writeFileSync(file, JSON.stringify({ killSwitch: true }));
      updateSettings({ ...valid });
      expect(() => updateSettings({ dnsUpstreamUrl: "" })).toThrow(SettingsValidationError);
      expect(getSettings().dnsUpstreamUrl).toBe(valid.dnsUpstreamUrl);
    });
  });
});
