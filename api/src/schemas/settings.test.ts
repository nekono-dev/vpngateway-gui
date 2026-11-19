// 責務: 設定更新で公開する Gateway 適用エラーコードを検証する。
import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { SettingsApplyErrorResponseSchema } from "./settings.js";

describe("SettingsApplyErrorResponseSchema", () => {
  it("有効な Gateway 設定が反映できない 503 code を列挙する", () => {
    expect(Value.Check(SettingsApplyErrorResponseSchema, { error: "kill_switch_not_applied" })).toBe(true);
    expect(Value.Check(SettingsApplyErrorResponseSchema, { error: "gateway_setting_not_applied" })).toBe(true);
    expect(Value.Check(SettingsApplyErrorResponseSchema, { error: "guard_apply_failed" })).toBe(false);
  });
});
