// 責務: 有効なベンダーの読み込み（provider-registry.ts）・選択中のベンダーの永続化（active-provider-store.ts）・
// ベンダー別の状態パスと旧形式からの移行（provider-state-paths.ts）の単体テスト。

import { beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "vpngwgui-providers-"));
const profilesDir = join(root, "profiles");
const stateDirPath = join(root, "state");
mkdirSync(profilesDir);
mkdirSync(stateDirPath);
copyFileSync(join(import.meta.dirname, "../../config/profiles/adguardvpn.json"), join(profilesDir, "adguardvpn.json"));
copyFileSync(join(import.meta.dirname, "../../test-fixtures/profiles/mockproton.json"), join(profilesDir, "mockproton.json"));
process.env.VPN_PROFILES_DIR = profilesDir;
process.env.STATE_DIR = stateDirPath;

const registry = await import("./provider-registry.js");
const active = await import("./active-provider-store.js");
const paths = await import("./provider-state-paths.js");

/** 環境変数を設定し、レジストリのキャッシュを破棄して読み直させる。 */
function useProviders(ids: string): void {
  process.env.ENABLED_PROVIDERS = ids;
  registry.resetProviderRegistryForTest();
}

describe("getProviders", () => {
  it("有効化された順にプロファイルを読み込み、表示名（displayName、無ければvendor）を持つ", () => {
    useProviders("mockproton,adguardvpn");
    expect(registry.getProviders().map((p) => [p.id, p.displayName])).toEqual([
      ["mockproton", "Proton VPN（モック）"],
      ["adguardvpn", "AdGuard VPN"],
    ]);
  });

  it("未設定なら既定でadguardvpnのみ", () => {
    delete process.env.ENABLED_PROVIDERS;
    registry.resetProviderRegistryForTest();
    expect(registry.getProviders().map((p) => p.id)).toEqual(["adguardvpn"]);
  });

  it("有効なベンダーが0個・重複・不正なIDは起動失敗（例外）", () => {
    useProviders(" , ");
    expect(() => registry.getProviders()).toThrow("no VPN provider is enabled");
    useProviders("adguardvpn,adguardvpn");
    expect(() => registry.getProviders()).toThrow("duplicate");
    useProviders("../etc/passwd");
    expect(() => registry.getProviders()).toThrow("invalid provider id");
  });

  it("プロファイルが無い・ファイル内のvendorがファイル名と一致しない場合は起動失敗", () => {
    useProviders("noprofile");
    expect(() => registry.getProviders()).toThrow();
    const mismatched = JSON.parse(readFileSync(join(profilesDir, "adguardvpn.json"), "utf8"));
    mismatched.vendor = "other";
    writeFileSync(join(profilesDir, "wrongname.json"), JSON.stringify(mismatched));
    useProviders("wrongname");
    expect(() => registry.getProviders()).toThrow("must equal the file name");
  });

  it("findProviderは有効でないIDにundefinedを返す", () => {
    useProviders("adguardvpn");
    expect(registry.findProvider("adguardvpn")?.id).toBe("adguardvpn");
    expect(registry.findProvider("mockproton")).toBeUndefined();
  });
});

describe("選択中のベンダー（active-provider-store）", () => {
  beforeEach(() => {
    useProviders("adguardvpn,mockproton");
    writeFileSync(join(stateDirPath, "active-provider.json"), "");
  });

  it("未保存・破損なら有効なベンダーの先頭", () => {
    expect(active.getActiveProvider().id).toBe("adguardvpn");
    writeFileSync(join(stateDirPath, "active-provider.json"), "not json");
    expect(active.getActiveProvider().id).toBe("adguardvpn");
  });

  it("保存したベンダーを返す（永続化）", () => {
    active.saveActiveProviderId("mockproton");
    expect(active.getActiveProvider().id).toBe("mockproton");
  });

  it("保存済みのIDが有効でなくなった（管理者が無効化した）場合は先頭にフォールバックする", () => {
    active.saveActiveProviderId("mockproton");
    useProviders("adguardvpn");
    expect(active.getActiveProvider().id).toBe("adguardvpn");
  });
});

describe("ベンダー別の状態パスと旧形式からの移行", () => {
  it("providers/<ID>/<ファイル名>を返す", () => {
    expect(paths.providerStatePath("adguardvpn", "last-location.json")).toBe(join(stateDirPath, "providers", "adguardvpn", "last-location.json"));
  });

  it("adguardvpnが有効なら、旧形式のファイルをproviders/adguardvpn/へ移し、冪等（再実行で何も起きない）", () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-migrate-"));
    const previous = process.env.STATE_DIR;
    process.env.STATE_DIR = dir;
    try {
      writeFileSync(join(dir, "favorite-locations.json"), JSON.stringify({ ids: ["jp-tokyo"] }));
      writeFileSync(join(dir, "last-location.json"), JSON.stringify({ id: "jp-tokyo" }));
      expect(paths.migrateLegacyState(["adguardvpn", "mockproton"]).sort()).toEqual(["favorite-locations.json", "last-location.json"]);
      expect(existsSync(join(dir, "favorite-locations.json"))).toBe(false);
      expect(JSON.parse(readFileSync(join(dir, "providers", "adguardvpn", "favorite-locations.json"), "utf8"))).toEqual({ ids: ["jp-tokyo"] });
      expect(paths.migrateLegacyState(["adguardvpn"])).toEqual([]);
    } finally {
      process.env.STATE_DIR = previous;
    }
  });

  it("adguardvpnが有効でなければ移さない（別ベンダーの状態として誤って引き継がない）", () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-migrate-"));
    const previous = process.env.STATE_DIR;
    process.env.STATE_DIR = dir;
    try {
      writeFileSync(join(dir, "last-location.json"), JSON.stringify({ id: "jp-tokyo" }));
      expect(paths.migrateLegacyState(["mockproton"])).toEqual([]);
      expect(existsSync(join(dir, "last-location.json"))).toBe(true);
    } finally {
      process.env.STATE_DIR = previous;
    }
  });

  it("移動先に既にファイルがあれば上書きしない", () => {
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-migrate-"));
    const previous = process.env.STATE_DIR;
    process.env.STATE_DIR = dir;
    try {
      mkdirSync(join(dir, "providers", "adguardvpn"), { recursive: true });
      writeFileSync(join(dir, "providers", "adguardvpn", "last-location.json"), JSON.stringify({ id: "us-new" }));
      writeFileSync(join(dir, "last-location.json"), JSON.stringify({ id: "jp-old" }));
      expect(paths.migrateLegacyState(["adguardvpn"])).toEqual([]);
      expect(JSON.parse(readFileSync(join(dir, "providers", "adguardvpn", "last-location.json"), "utf8")).id).toBe("us-new");
    } finally {
      process.env.STATE_DIR = previous;
    }
  });
});
