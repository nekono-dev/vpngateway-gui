// 責務: ping 計測の可否の判定（宣言 locationPing が false のときだけ計測できない）を確かめる。
import { describe, expect, it } from "vitest";
import { isPingMeasurable } from "./capability-evaluator.js";
import type { VendorProfile } from "../profile/profile.schema.js";

const base = { vendor: "x", binary: "/bin/x", outputFormat: "text", loginMethod: "deviceUrl", actions: {} } as unknown as VendorProfile;

describe("isPingMeasurable", () => {
  it("宣言が無ければ計測できる", () => {
    expect(isPingMeasurable(base)).toBe(true);
  });

  it("locationPing が false なら計測できない", () => {
    expect(isPingMeasurable({ ...base, features: { locationPing: false } })).toBe(false);
  });

  it("locationPing が true なら計測できる", () => {
    expect(isPingMeasurable({ ...base, features: { locationPing: true } })).toBe(true);
  });
});
