import { describe, expect, it } from "vitest";
import { PlaceholderValidationError, resolveArgv } from "./placeholder-resolver.js";
import type { VendorProfile } from "./profile.schema.js";

function buildProfile(overrides: Partial<VendorProfile> = {}): VendorProfile {
  return {
    vendor: "adguardvpn",
    binary: "/usr/local/bin/adguardvpn-cli",
    outputFormat: "text",
    actions: {
      connect: {
        argv: ["connect", "-l", "%COUNTRY%", "-y"],
        placeholders: {
          COUNTRY: { pattern: "^[a-z]{2}$", source: "enum", enumFrom: "adguardvpn.countries" },
        },
        timeoutMs: 30000,
      },
      disconnect: { argv: ["disconnect"], placeholders: {}, timeoutMs: 15000 },
      status: { argv: ["status"], placeholders: {}, timeoutMs: 8000 },
      login: { argv: ["login"], placeholders: {}, timeoutMs: 15000 },
    },
    countries: ["jp", "us"],
    ...overrides,
  };
}

describe("resolveArgv", () => {
  it("プレースホルダーを許可された値に置き換えたargvを返す", () => {
    const profile = buildProfile();
    expect(resolveArgv(profile, "connect", { COUNTRY: "jp" })).toEqual(["connect", "-l", "jp", "-y"]);
  });

  it("プレースホルダーを含まないargvはそのまま返す", () => {
    const profile = buildProfile();
    expect(resolveArgv(profile, "disconnect", {})).toEqual(["disconnect"]);
  });

  it("値が指定されない場合はPlaceholderValidationErrorを投げる", () => {
    const profile = buildProfile();
    expect(() => resolveArgv(profile, "connect", {})).toThrow(PlaceholderValidationError);
  });

  it("値が正規表現パターンに一致しない場合はPlaceholderValidationErrorを投げる", () => {
    const profile = buildProfile();
    expect(() => resolveArgv(profile, "connect", { COUNTRY: "JP" })).toThrow(PlaceholderValidationError);
    expect(() => resolveArgv(profile, "connect", { COUNTRY: "; rm -rf /" })).toThrow(PlaceholderValidationError);
  });

  it("値がパターンには一致するが列挙値一覧に含まれない場合はPlaceholderValidationErrorを投げる", () => {
    const profile = buildProfile();
    expect(() => resolveArgv(profile, "connect", { COUNTRY: "zz" })).toThrow(PlaceholderValidationError);
  });

  it("enumFromのvendor名がプロファイルのvendorと一致しない場合は例外を投げる", () => {
    const profile = buildProfile({
      actions: {
        ...buildProfile().actions,
        connect: {
          argv: ["connect", "-l", "%COUNTRY%"],
          placeholders: {
            COUNTRY: { pattern: "^[a-z]{2}$", source: "enum", enumFrom: "otherVendor.countries" },
          },
          timeoutMs: 30000,
        },
      },
    });
    expect(() => resolveArgv(profile, "connect", { COUNTRY: "jp" })).toThrow(/enumFrom vendor mismatch/);
  });
});
