// 責務: プロファイルの最上位の国コードの対応（countryAliases）が読み込めることを確かめる。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseProfileFile } from "./profile-loader.js";

const vendorProfile = (vendor: string): string => fileURLToPath(new URL(`../../../vendors/${vendor}/profile.json`, import.meta.url));

describe("countryAliases（プロファイルの最上位）", () => {
  it("ProtonVPN の宣言から、UK→GB と XK→KOS を読める", () => {
    const profile = parseProfileFile(vendorProfile("protonvpn"));
    expect(profile.countryAliases).toEqual({ UK: "GB", XK: "KOS" });
  });

  it("宣言が無いプロファイルも従来どおり読める（対応は未定義）", () => {
    const profile = parseProfileFile(vendorProfile("adguardvpn"));
    expect(profile.countryAliases).toBeUndefined();
  });
});
