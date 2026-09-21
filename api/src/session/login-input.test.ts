import { describe, expect, it } from "vitest";
import { PlaceholderValidationError } from "../profile/placeholder-resolver.js";
import { assertValidSecrets, buildLoginStdin } from "./login-input.js";

describe("assertValidSecrets", () => {
  it("通常のパスワードと2FAコードを受理する", () => {
    expect(() => assertValidSecrets({ username: "u", password: "p@ss w0rd!", twoFactorCode: "123456" })).not.toThrow();
  });

  it("パスワードに改行を含むと拒否する（標準入力への余分な行の混入＝2FA入力の偽装を防ぐ）", () => {
    expect(() => assertValidSecrets({ username: "u", password: "pass\n123456" })).toThrow(PlaceholderValidationError);
    expect(() => assertValidSecrets({ username: "u", password: "pass\r" })).toThrow(PlaceholderValidationError);
  });

  it("NULなどの制御文字を含むパスワードを拒否する", () => {
    expect(() => assertValidSecrets({ username: "u", password: "pa\u0000ss" })).toThrow(PlaceholderValidationError);
  });

  it("空・長すぎるパスワードを拒否する", () => {
    expect(() => assertValidSecrets({ username: "u", password: "" })).toThrow(PlaceholderValidationError);
    expect(() => assertValidSecrets({ username: "u", password: "x".repeat(513) })).toThrow(PlaceholderValidationError);
  });

  it("形式不正の2FAコードを拒否する。空文字は未指定として扱う", () => {
    expect(() => assertValidSecrets({ username: "u", password: "p", twoFactorCode: "12 34" })).toThrow(PlaceholderValidationError);
    expect(() => assertValidSecrets({ username: "u", password: "p", twoFactorCode: "12\n34" })).toThrow(PlaceholderValidationError);
    expect(() => assertValidSecrets({ username: "u", password: "p", twoFactorCode: "" })).not.toThrow();
  });

  it("エラーメッセージに入力値（秘密）を含めない", () => {
    try {
      assertValidSecrets({ username: "u", password: "sup3r-secret\n" });
    } catch (error) {
      expect((error as Error).message).not.toContain("sup3r-secret");
    }
  });
});

describe("buildLoginStdin", () => {
  it("パスワードの1行を返す", () => {
    expect(buildLoginStdin({ username: "u", password: "pw" })).toBe("pw\n");
  });

  it("2FAコードがあれば続けて1行を返す。空文字は付けない", () => {
    expect(buildLoginStdin({ username: "u", password: "pw", twoFactorCode: "123456" })).toBe("pw\n123456\n");
    expect(buildLoginStdin({ username: "u", password: "pw", twoFactorCode: "" })).toBe("pw\n");
  });
});
