import { describe, expect, it } from "vitest";
import { PlaceholderValidationError, resolveArgv, resolveStdin } from "./placeholder-resolver.js";
import type { VendorProfile } from "./profile.schema.js";

function buildProfile(overrides: Partial<VendorProfile> = {}): VendorProfile {
  return {
    vendor: "adguardvpn",
    binary: "/usr/local/bin/adguardvpn-cli",
    outputFormat: "text",
    loginMethod: "deviceUrl",
    actions: {
      connect: {
        argv: ["connect", "-l", "%COUNTRY%", "-y"],
        placeholders: {
          COUNTRY: { pattern: "^[a-z]{2}$", source: "locations" },
        },
        timeoutMs: 30000,
      },
      disconnect: { argv: ["disconnect"], placeholders: {}, timeoutMs: 15000 },
      status: { argv: ["status"], placeholders: {}, timeoutMs: 8000 },
      login: { argv: ["login"], placeholders: {}, timeoutMs: 15000 },
      listLocations: { argv: ["list-locations"], placeholders: {}, timeoutMs: 15000 },
    },
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
    expect(resolveArgv(profile, "connect", { COUNTRY: "jp" }, { COUNTRY: ["jp", "us"] })).toEqual(["connect", "-l", "jp", "-y"]);
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

  it("値がパターンには一致するが実行時の許可値に含まれない場合はPlaceholderValidationErrorを投げる", () => {
    const profile = buildProfile();
    expect(() => resolveArgv(profile, "connect", { COUNTRY: "zz" }, { COUNTRY: ["jp", "us"] })).toThrow(PlaceholderValidationError);
  });

  it("secretのプレースホルダーをargvに置くことは許さない（秘密をコマンド引数へ残さない）", () => {
    const profile = buildProfile({
      actions: {
        ...buildProfile().actions,
        login: { argv: ["signin", "%PASSWORD%"], placeholders: { PASSWORD: { pattern: "^.+$", source: "secret" } }, timeoutMs: 1000 },
      },
    });
    expect(() => resolveArgv(profile, "login", { PASSWORD: "p" })).toThrow(/secret placeholder must not be used in argv/);
  });
});

describe("resolveStdin", () => {
  const credentialsProfile = buildProfile({
    loginMethod: "credentials",
    actions: {
      ...buildProfile().actions,
      login: {
        argv: ["signin", "%USERNAME%"],
        placeholders: {
          USERNAME: { pattern: "^[^\\s]+$", source: "input" },
          PASSWORD: { pattern: "^[^\\x00-\\x1f\\x7f]{1,512}$", source: "secret" },
          TWO_FACTOR_CODE: { pattern: "^[0-9A-Za-z]{4,32}$", source: "secret", optional: true },
        },
        stdin: ["%PASSWORD%", "%TWO_FACTOR_CODE%"],
        timeoutMs: 60000,
      },
    },
  });

  it("テンプレートの順にパスワード・2FAコードの行を組み立てる", () => {
    expect(resolveStdin(credentialsProfile, "login", { PASSWORD: "pass", TWO_FACTOR_CODE: "123456" })).toBe("pass\n123456\n");
  });

  it("optionalな2FAコードが未指定・空なら、その行を出さない", () => {
    expect(resolveStdin(credentialsProfile, "login", { PASSWORD: "pass" })).toBe("pass\n");
    expect(resolveStdin(credentialsProfile, "login", { PASSWORD: "pass", TWO_FACTOR_CODE: "" })).toBe("pass\n");
  });

  it("必須の値が無い・patternに一致しない（改行・制御文字を含む）場合はPlaceholderValidationErrorで、エラーに値を含めない", () => {
    expect(() => resolveStdin(credentialsProfile, "login", {})).toThrow(PlaceholderValidationError);
    expect(() => resolveStdin(credentialsProfile, "login", { PASSWORD: "pass\nword" })).toThrow(PlaceholderValidationError);
    expect(() => resolveStdin(credentialsProfile, "login", { PASSWORD: "pass", TWO_FACTOR_CODE: "12 34" })).toThrow(
      PlaceholderValidationError,
    );
    try {
      resolveStdin(credentialsProfile, "login", { PASSWORD: "s3cret\n" });
    } catch (error) {
      expect((error as Error).message).not.toContain("s3cret");
    }
  });

  it("stdinが未定義のアクションはundefined（標準入力を使わない）", () => {
    expect(resolveStdin(buildProfile(), "status", {})).toBeUndefined();
  });

  it("stdinがsecretでないプレースホルダーを参照していれば拒否する", () => {
    const profile = buildProfile({
      actions: {
        ...buildProfile().actions,
        login: { argv: ["login"], placeholders: { USERNAME: { pattern: "^.+$", source: "input" } }, stdin: ["%USERNAME%"], timeoutMs: 1000 },
      },
    });
    expect(() => resolveStdin(profile, "login", { USERNAME: "u" })).toThrow(/secret placeholder/);
  });
});
