// 責務: ユーザ向け設定ストアの読み込み互換性（廃止項目の無視・不足項目のデフォルト補完）の単体テスト。

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const file = join(mkdtempSync(join(tmpdir(), "vpngwgui-settings-")), "settings.json");
process.env.SETTINGS_FILE = file;

const { getSettings, updateSettings } = await import("./settings-store.js");

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
});

