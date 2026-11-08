import { beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-city-tab-"));
process.env.STATE_DIR = dir;
const proton = "protonvpn";
const adguard = "adguardvpn";
const protonDir = join(dir, "providers", proton);
const tabFile = join(protonDir, "city-tab.json");
const tabs = await import("./city-tab-store.js");

describe("city-tab-store", () => {
  beforeEach(() => {
    rmSync(join(dir, "providers"), { recursive: true, force: true });
  });

  it("未保存なら『最速サーバ』を返す", () => {
    expect(tabs.readCityTab(proton)).toBe("fastest");
  });

  it.each(["fastest", "select"] as const)("タブ %s を保存して読み出す", (tab) => {
    tabs.saveCityTab(proton, tab);
    expect(tabs.readCityTab(proton)).toBe(tab);
  });

  it("プロバイダごとにタブを分ける", () => {
    tabs.saveCityTab(proton, "select");
    expect(tabs.readCityTab(proton)).toBe("select");
    expect(tabs.readCityTab(adguard)).toBe("fastest");
  });

  it("不正な保存値は既定値に戻す", () => {
    mkdirSync(protonDir, { recursive: true });
    writeFileSync(tabFile, JSON.stringify({ tab: "unknown" }));
    expect(tabs.readCityTab(proton)).toBe("fastest");
    writeFileSync(tabFile, JSON.stringify({ tab: "server" }));
    expect(tabs.readCityTab(proton)).toBe("fastest");
    writeFileSync(tabFile, JSON.stringify({ tab: 3 }));
    expect(tabs.readCityTab(proton)).toBe("fastest");
  });

  it("壊れたファイルは既定値に戻す", () => {
    mkdirSync(protonDir, { recursive: true });
    writeFileSync(tabFile, "{not json");
    expect(tabs.readCityTab(proton)).toBe("fastest");
  });

  it.each(["../escape", "UPPER", ""]) ("不正なプロバイダID %j は保存前に拒否する", (providerId) => {
    expect(() => tabs.saveCityTab(providerId, "select")).toThrow();
    expect(() => tabs.readCityTab(providerId)).toThrow();
  });
});
