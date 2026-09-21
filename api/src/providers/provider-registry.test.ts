// 責務: 有効なベンダーの読み込み（provider-registry.ts）・選択中のベンダーの永続化（active-provider-store.ts）・
// ベンダー別の状態パスと旧形式からの移行（provider-state-paths.ts）の単体テスト。

import { beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "vpngwgui-providers-"));
const profilesDir = join(root, "profiles");
const stateDirPath = join(root, "state");
mkdirSync(profilesDir);
mkdirSync(stateDirPath);
for (const [id, source] of [["adguardvpn", "../../../vendors/adguardvpn/profile.json"], ["mockproton", "../../../e2e/vendors/mockproton/profile.json"]]) {
  mkdirSync(join(profilesDir, id));
  copyFileSync(join(import.meta.dirname, source), join(profilesDir, id, "profile.json"));
}
process.env.VENDORS_DIR = profilesDir;
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

  it("未設定は起動失敗（既定のベンダーを持たない）", () => {
    delete process.env.ENABLED_PROVIDERS;
    registry.resetProviderRegistryForTest();
    expect(() => registry.getProviders()).toThrow("ENABLED_PROVIDERS is required");
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
    const mismatched = JSON.parse(readFileSync(join(profilesDir, "adguardvpn", "profile.json"), "utf8"));
    mismatched.vendor = "other";
    mkdirSync(join(profilesDir, "wrongname"));
    writeFileSync(join(profilesDir, "wrongname", "profile.json"), JSON.stringify(mismatched));
    useProviders("wrongname");
    expect(() => registry.getProviders()).toThrow("must equal the directory name");
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

describe("ベンダー別の状態パス", () => {
  it("providers/<ID>/<ファイル名>を返す", () => {
    expect(paths.providerStatePath("adguardvpn", "last-location.json")).toBe(join(stateDirPath, "providers", "adguardvpn", "last-location.json"));
  });
});
