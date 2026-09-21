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
    // 保存ファイルに無い項目はデフォルト値で補う
    expect(settings.transparentGatewayEnabled).toBe(false);
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
});
