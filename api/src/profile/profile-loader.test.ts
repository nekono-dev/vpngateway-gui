// 責務: プロファイルの組合せ検証（validateProfile）・ログイン方式の既定値（getLoginMethod）の単体テスト。
// 既存のAdGuard VPNプロファイルが追加項目なしのまま読み込めること（後方互換）も確認する。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { VendorProfileSchema, type VendorProfile } from "./profile.schema.js";
import { getLoginMethod, validateProfile } from "./profile-loader.js";

const load = (relative: string): VendorProfile => JSON.parse(readFileSync(join(import.meta.dirname, relative), "utf8")) as VendorProfile;
const adguard = load("../../config/profiles/adguardvpn.json");
const protonLike = load("../../test-fixtures/protonvpn-like.json");

describe("プロファイルのスキーマ・検証", () => {
  it("AdGuard VPNプロファイル（Phase 8形式）が、追加項目なしのままスキーマ・組合せ検証を通る", () => {
    expect(Value.Check(VendorProfileSchema, adguard)).toBe(true);
    expect(() => validateProfile(adguard)).not.toThrow();
  });

  it("Proton VPN相当のプロファイル（account・connectAuto・logout・table等）がスキーマ・組合せ検証を通る", () => {
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

    expect(() => validateProfile({ ...protonLike, output: { locationPattern: "[" } })).toThrow("invalid regular expression");
  });

  it("planのrestrictsに未知のオペレーション名があるとスキーマ検証に失敗する", () => {
    const unknownOp = JSON.parse(JSON.stringify(protonLike)) as VendorProfile;
    (unknownOp.actions.account!.plans[0].restricts as string[]).push("teleport");
    expect(Value.Check(VendorProfileSchema, unknownOp)).toBe(false);
  });

  it("ログイン方式は未指定ならURL提示型（deviceUrl）", () => {
    expect(getLoginMethod(adguard)).toBe("deviceUrl");
    expect(getLoginMethod(protonLike)).toBe("credentials");
  });
});
