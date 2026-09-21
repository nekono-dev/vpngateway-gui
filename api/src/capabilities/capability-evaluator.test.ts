// 責務: オペレーションの実行可否（capability-evaluator.ts）の単体テスト。
// 原因の優先順（unsupported > notLoggedIn > planRestricted）と、依存するオペレーションの原因継承を確認する。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateCapabilities, type SessionInfo } from "./capability-evaluator.js";
import type { VendorProfile } from "../profile/profile.schema.js";

function loadJson(name: string): VendorProfile {
  return JSON.parse(readFileSync(join(import.meta.dirname, name), "utf8")) as VendorProfile;
}

const adguard = loadJson("../../config/profiles/adguardvpn.json");
const protonLike = loadJson("../../test-fixtures/protonvpn-like.json");

const freePlan: SessionInfo = {
  loggedIn: true,
  plan: {
    id: "free",
    label: "Free",
    restricts: ["connectToLocation", "locationList"],
    restrictionMessage: "無料プランでは接続先を選べません。",
  },
};
const paidPlan: SessionInfo = { loggedIn: true, plan: { id: "paid", label: "Paid", restricts: [] } };
const noLearned = new Map<never, string>();

describe("evaluateCapabilities", () => {
  it("AdGuard VPN（状態不明）では、対応する操作は全て可、非対応の操作（connectAuto）だけがunsupported", () => {
    const caps = evaluateCapabilities(adguard, {}, noLearned);
    expect(caps.connectToLocation.available).toBe(true);
    expect(caps.locationList.available).toBe(true);
    expect(caps.locationFavorites.available).toBe(true);
    expect(caps.pingMeasurement.available).toBe(true);
    expect(caps.changeLocation.available).toBe(true);
    expect(caps.login.available).toBe(true);
    expect(caps.disconnect.available).toBe(true);
    expect(caps.connectAuto).toMatchObject({ available: false, reason: "unsupported" });
    expect(caps.logout.available).toBe(true);
  });

  it("無料プラン: 接続先の指定と一覧がplanRestricted（プランの理由文）、依存する操作も同じ原因を継承する", () => {
    const caps = evaluateCapabilities(protonLike, freePlan, noLearned);
    expect(caps.connectToLocation).toEqual({ available: false, reason: "planRestricted", message: "無料プランでは接続先を選べません。" });
    expect(caps.locationList).toMatchObject({ available: false, reason: "planRestricted" });
    // 依存: 一覧が不可ならお気に入りも、接続先の指定が不可なら接続先変更も不可（同じ原因・理由文）。
    expect(caps.locationFavorites).toMatchObject({ available: false, reason: "planRestricted", message: "無料プランでは接続先を選べません。" });
    expect(caps.changeLocation).toMatchObject({ available: false, reason: "planRestricted" });
    // 自動接続・切断・ログアウトは無料でも可。
    expect(caps.connectAuto.available).toBe(true);
    expect(caps.disconnect.available).toBe(true);
    expect(caps.logout.available).toBe(true);
  });

  it("pingを提供しないプロバイダ（features.locationPing=false）はpingMeasurementがunsupported（プラン制限より優先）", () => {
    expect(evaluateCapabilities(protonLike, paidPlan, noLearned).pingMeasurement).toMatchObject({
      available: false,
      reason: "unsupported",
    });
    // 無料でも、一覧の制限（planRestricted）ではなく自身の非対応が優先される。
    expect(evaluateCapabilities(protonLike, freePlan, noLearned).pingMeasurement).toMatchObject({
      available: false,
      reason: "unsupported",
    });
  });

  it("有料プラン: 接続先の指定・一覧・お気に入り・接続先変更が可", () => {
    const caps = evaluateCapabilities(protonLike, paidPlan, noLearned);
    expect(caps.connectToLocation.available).toBe(true);
    expect(caps.locationList.available).toBe(true);
    expect(caps.locationFavorites.available).toBe(true);
    expect(caps.changeLocation.available).toBe(true);
    expect(caps.connectAuto.available).toBe(true);
  });

  it("未ログイン: 接続系・一覧・ログアウトがnotLoggedIn。ログインと切断は可", () => {
    const caps = evaluateCapabilities(protonLike, { loggedIn: false }, noLearned);
    for (const key of ["connectToLocation", "connectAuto", "locationList", "logout"] as const) {
      expect(caps[key]).toEqual({ available: false, reason: "notLoggedIn", message: "ログインしてください" });
    }
    expect(caps.locationFavorites).toMatchObject({ available: false, reason: "notLoggedIn" });
    expect(caps.changeLocation).toMatchObject({ available: false, reason: "notLoggedIn" });
    expect(caps.login.available).toBe(true);
    expect(caps.disconnect.available).toBe(true);
  });

  it("状態不明（loggedInが未定義）では制限しない（判定不能を理由に操作を塞がない）", () => {
    const caps = evaluateCapabilities(protonLike, {}, noLearned);
    expect(caps.connectToLocation.available).toBe(true);
    expect(caps.locationList.available).toBe(true);
    expect(caps.connectAuto.available).toBe(true);
  });

  it("学習した制限はplanRestrictedとして反映され、依存する操作にも及ぶ", () => {
    const learned = new Map([["connectToLocation" as const, "現在のプランでは利用できない操作です"]]);
    const caps = evaluateCapabilities(protonLike, paidPlan, learned);
    expect(caps.connectToLocation).toEqual({ available: false, reason: "planRestricted", message: "現在のプランでは利用できない操作です" });
    expect(caps.changeLocation).toMatchObject({ available: false, reason: "planRestricted" });
    // 接続先を指定できないなら一覧も意味が無いため、一覧も同じ原因で実行不可（相互依存）。
    expect(caps.locationList).toEqual({ available: false, reason: "planRestricted", message: "現在のプランでは利用できない操作です" });
    expect(caps.locationFavorites).toMatchObject({ available: false, reason: "planRestricted" });
    // 自動接続は影響を受けない。
    expect(caps.connectAuto.available).toBe(true);
  });

  it("一覧だけが制限されても、接続先を解決できないため接続先の指定も同じ原因で実行不可になる", () => {
    const learned = new Map([["locationList" as const, "現在のプランでは利用できない操作です"]]);
    const caps = evaluateCapabilities(protonLike, paidPlan, learned);
    expect(caps.locationList).toMatchObject({ available: false, reason: "planRestricted" });
    expect(caps.connectToLocation).toMatchObject({ available: false, reason: "planRestricted" });
    expect(caps.changeLocation).toMatchObject({ available: false, reason: "planRestricted" });
  });

  it("プランの理由文が無いときは、プラン名を含む既定の理由文にする", () => {
    const plan: SessionInfo = { loggedIn: true, plan: { id: "free", label: "Free", restricts: ["locationList"] } };
    expect(evaluateCapabilities(protonLike, plan, noLearned).locationList.message).toBe("現在のプラン（Free）では利用できません");
  });

  it("connectのみ・listLocations無しのプロファイルではconnectToLocationがunsupported（組で必要）", () => {
    const withoutList: VendorProfile = { ...protonLike, actions: { ...protonLike.actions, listLocations: undefined } };
    const caps = evaluateCapabilities(withoutList, paidPlan, noLearned);
    expect(caps.connectToLocation).toMatchObject({ available: false, reason: "unsupported" });
    expect(caps.locationList).toMatchObject({ available: false, reason: "unsupported" });
    expect(caps.locationFavorites).toMatchObject({ available: false, reason: "unsupported" });
  });
});
