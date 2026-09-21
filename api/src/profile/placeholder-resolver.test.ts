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
      listLocations: { argv: ["list-locations"], placeholders: {}, timeoutMs: 15000 },
    },
    // "enum"出典が参照する配列フィールド（プロファイルは追加のプロパティを持てる）。
    countries: ["jp", "us"],
    ...overrides,
  } as VendorProfile;
}

// Phase 8: 許可値が実行時に決まる"locations"出典のプロファイル。
function buildLocationsProfile(): VendorProfile {
  const base = buildProfile();
  return {
    ...base,
    actions: {
      ...base.actions,
      connect: {
        argv: ["connect", "-l", "%LOCATION%", "-y"],
        placeholders: { LOCATION: { pattern: "^[^\\-\\s][^\\x00-\\x1f]{0,62}$", source: "locations" } },
        timeoutMs: 30000,
      },
    },
  };
}

describe("resolveArgv (source: locations)", () => {
  const allowed = { LOCATION: ["Tokyo", "São Paulo", "Las Vegas"] };

  it("実行時に渡された許可値に含まれる値（空白・非ASCII含む）を代入する", () => {
    const profile = buildLocationsProfile();
    expect(resolveArgv(profile, "connect", { LOCATION: "Las Vegas" }, allowed)).toEqual(["connect", "-l", "Las Vegas", "-y"]);
    expect(resolveArgv(profile, "connect", { LOCATION: "São Paulo" }, allowed)).toEqual(["connect", "-l", "São Paulo", "-y"]);
  });

  it("許可値に含まれない値・許可値が渡されない場合はPlaceholderValidationErrorを投げる", () => {
    const profile = buildLocationsProfile();
    expect(() => resolveArgv(profile, "connect", { LOCATION: "Atlantis" }, allowed)).toThrow(PlaceholderValidationError);
    expect(() => resolveArgv(profile, "connect", { LOCATION: "Tokyo" })).toThrow(/were not provided/);
  });

  it("先頭が-の値（CLIオプションとして解釈される）は、許可値に含まれていてもパターンで拒否する", () => {
    const profile = buildLocationsProfile();
    expect(() => resolveArgv(profile, "connect", { LOCATION: "--help" }, { LOCATION: ["--help"] })).toThrow(
      PlaceholderValidationError,
    );
  });
});

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
