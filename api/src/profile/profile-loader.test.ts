// 責務: プロファイルの組合せ検証（validateProfile）の単体テスト。ベンダー固有になりうる項目に既定値を持たず、
// 必須項目が欠けたプロファイルを拒否すること（Phase 12）と、同梱のバンドルのプロファイルが検証を通ることを確認する。

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { VendorProfileSchema, type VendorProfile } from "./profile.schema.js";
import { parseProfileFile, validateProfile } from "./profile-loader.js";

const load = (relative: string): VendorProfile => JSON.parse(readFileSync(join(import.meta.dirname, relative), "utf8")) as VendorProfile;
const adguard = load("../../../vendors/adguardvpn/profile.json");
const protonLike = load("../../../e2e/vendors/mockproton/profile.json");

describe("プロファイルのスキーマ・検証", () => {
  it("URL提示型のプロファイルが、スキーマ・組合せ検証を通る", () => {
    expect(Value.Check(VendorProfileSchema, adguard)).toBe(true);
    expect(() => validateProfile(adguard)).not.toThrow();
  });

  it("入力型のプロファイル（account・connectAuto・logout・table・login.stdin等）がスキーマ・組合せ検証を通る", () => {
    expect(Value.Check(VendorProfileSchema, protonLike)).toBe(true);
    expect(() => validateProfile(protonLike)).not.toThrow();
  });

  it("connectもconnectAutoも無いプロファイルは拒否する（接続手段が無いプロバイダは成立しない）", () => {
    const broken: VendorProfile = { ...protonLike, actions: { ...protonLike.actions, connect: undefined, connectAuto: undefined } };
    expect(() => validateProfile(broken)).toThrow("at least one of");
  });

  it("connectAutoだけのプロファイルは受理する", () => {
    const autoOnly: VendorProfile = { ...protonLike, actions: { ...protonLike.actions, connect: undefined } };
    expect(() => validateProfile(autoOnly)).not.toThrow();
  });

  it("不正な正規表現（restrictedPattern・account.plans[].pattern・output.locationPattern）はロード時に拒否する", () => {
    const badRestricted: VendorProfile = {
      ...protonLike,
      actions: { ...protonLike.actions, connectAuto: { ...protonLike.actions.connectAuto!, restrictedPattern: "([unclosed" } },
    };
    expect(() => validateProfile(badRestricted)).toThrow("invalid regular expression");

    const badPlan: VendorProfile = {
      ...protonLike,
      actions: {
        ...protonLike.actions,
        account: { ...protonLike.actions.account!, plans: [{ id: "x", label: "X", pattern: "(", restricts: [] }] },
      },
    };
    expect(() => validateProfile(badPlan)).toThrow("invalid regular expression");

    expect(() => validateProfile({ ...protonLike, output: { connectedPattern: "connected", locationPattern: "[" } })).toThrow("invalid regular expression");
    expect(() => validateProfile({ ...protonLike, output: { connectedPattern: "(", locationPattern: "x" } })).toThrow("invalid regular expression");
  });

  it("planのrestrictsに未知のオペレーション名があるとスキーマ検証に失敗する", () => {
    const unknownOp = JSON.parse(JSON.stringify(protonLike)) as VendorProfile;
    (unknownOp.actions.account!.plans[0].restricts as string[]).push("teleport");
    expect(Value.Check(VendorProfileSchema, unknownOp)).toBe(false);
  });

  it("ログイン方式は必須（既定を持たない）", () => {
    const { loginMethod: _omitted, ...withoutLoginMethod } = adguard;
    void _omitted;
    expect(Value.Check(VendorProfileSchema, withoutLoginMethod)).toBe(false);
  });

  it("text形式では output.connectedPattern・output.locationPattern が必須", () => {
    expect(() => validateProfile({ ...adguard, output: undefined })).toThrow("output.connectedPattern");
    expect(() => validateProfile({ ...adguard, output: { connectedPattern: "connected" } })).toThrow("output.locationPattern");
  });

  it("listLocationsのtable・connectNameは必須で、stripPatternの正規表現はロード時に検証する", () => {
    const noTable = JSON.parse(JSON.stringify(adguard)) as VendorProfile;
    delete (noTable.actions.listLocations as { table?: unknown }).table;
    expect(Value.Check(VendorProfileSchema, noTable)).toBe(false);
    const badStrip = JSON.parse(JSON.stringify(adguard)) as VendorProfile;
    badStrip.actions.listLocations!.connectName.stripPattern = "(";
    expect(() => validateProfile(badStrip)).toThrow("invalid regular expression");
  });

  it("secretのプレースホルダー: argvに置く・制御文字を許すpattern・secretでないstdin参照は拒否する", () => {
    const withLogin = (login: NonNullable<VendorProfile["actions"]["login"]>): VendorProfile => ({
      ...protonLike,
      actions: { ...protonLike.actions, login },
    });
    const login = protonLike.actions.login!;
    expect(() => validateProfile(withLogin({ ...login, argv: ["signin", "%PASSWORD%"] }))).toThrow("must not appear in login.argv");
    expect(() =>
      validateProfile(withLogin({ ...login, placeholders: { ...login.placeholders, PASSWORD: { pattern: "^.+$", source: "secret" } } })),
    ).toThrow("must reject newlines and control characters");
    expect(() => validateProfile(withLogin({ ...login, stdin: ["%USERNAME%"] }))).toThrow("not a secret placeholder");
  });

  it("credentials方式のloginは stdin の宣言が必須", () => {
    const { stdin: _omitted, ...loginWithoutStdin } = protonLike.actions.login!;
    void _omitted;
    expect(() => validateProfile({ ...protonLike, actions: { ...protonLike.actions, login: loginWithoutStdin } })).toThrow("login.stdin");
  });
});

describe("同梱のベンダーバンドルのプロファイル（vendors/<ID>/profile.json）", () => {
  const dir = join(import.meta.dirname, "../../../vendors");
  const files = readdirSync(dir).filter((name) => existsSync(join(dir, name, "profile.json"))).map((name) => join(name, "profile.json"));

  it("少なくとも1つのプロファイルがある", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s: スキーマ・組合せ検証を通り、ディレクトリ名がベンダーIDと一致する", (name) => {
    const profile = parseProfileFile(join(dir, name));
    expect(profile.vendor).toBe(name.replace(/[\\/]profile\.json$/, ""));
    expect(profile.displayName).toBeTruthy();
  });
});
