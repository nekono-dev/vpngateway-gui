import { afterEach, describe, expect, it } from "vitest";
import { CommandExecutionError, OperationRestrictedError } from "../errors.js";
import { clearLearnedRestrictions, getLearnedRestrictions, throwCommandFailure } from "./restriction-learner.js";

const P = "protonvpn";

describe("throwCommandFailure", () => {
  afterEach(() => {
    clearLearnedRestrictions(P);
  });

  it("restrictedPatternに一致する失敗はOperationRestrictedErrorになり、そのオペレーションを学習する", () => {
    expect(() =>
      throwCommandFailure(P, "connect failed", 2, "Error: Location selection is NOT AVAILABLE on the free plan.", {
        pattern: "not available on the free plan",
        operation: "connectToLocation",
      }),
    ).toThrow(OperationRestrictedError);
    expect(getLearnedRestrictions(P).has("connectToLocation")).toBe(true);
  });

  it("一致しない失敗は通常の実行失敗（CommandExecutionError）で、学習しない", () => {
    expect(() =>
      throwCommandFailure(P, "connect failed", 1, "Connection failed.", {
        pattern: "not available on the free plan",
        operation: "connectToLocation",
      }),
    ).toThrow(CommandExecutionError);
    expect(getLearnedRestrictions(P).size).toBe(0);
  });

  it("restrictedPatternが未定義のアクションは常に通常の実行失敗", () => {
    expect(() =>
      throwCommandFailure(P, "connect failed", 2, "not available on the free plan", { pattern: undefined, operation: "connectAuto" }),
    ).toThrow(CommandExecutionError);
  });

  it("clearLearnedRestrictionsで学習を破棄できる", () => {
    try {
      throwCommandFailure(P, "x", 2, "restricted", { pattern: "restricted", operation: "locationList" });
    } catch {
      // 学習の副作用だけを確認する。
    }
    expect(getLearnedRestrictions(P).size).toBe(1);
    clearLearnedRestrictions(P);
    expect(getLearnedRestrictions(P).size).toBe(0);
  });

  it("学習はベンダーごとに独立で、あるベンダーの制限が別のベンダーに及ばない・別のベンダーの破棄が影響しない", () => {
    expect(() =>
      throwCommandFailure("otherprovider", "x", 2, "restricted", { pattern: "restricted", operation: "connectToLocation" }),
    ).toThrow(OperationRestrictedError);
    expect(getLearnedRestrictions("otherprovider").has("connectToLocation")).toBe(true);
    expect(getLearnedRestrictions(P).size).toBe(0);
    clearLearnedRestrictions(P);
    expect(getLearnedRestrictions("otherprovider").has("connectToLocation")).toBe(true);
    clearLearnedRestrictions("otherprovider");
  });
});
