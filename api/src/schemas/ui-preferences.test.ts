// 責務: 表示設定（テーマ）のスキーマが、3種類の値だけを受け付けることの単体テスト。

import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { ThemePreferenceSchema, UiPreferencesSchema, UiPreferencesUpdateBodySchema } from "./ui-preferences.js";

describe("テーマの値の形", () => {
  it.each(["system", "light", "dark"])("%s は受け付ける", (theme) => {
    expect(Value.Check(ThemePreferenceSchema, theme)).toBe(true);
    expect(Value.Check(UiPreferencesSchema, { theme })).toBe(true);
    expect(Value.Check(UiPreferencesUpdateBodySchema, { theme })).toBe(true);
  });

  it.each(["auto", "", "Dark", null, 1])("%j は拒否する", (theme) => {
    expect(Value.Check(ThemePreferenceSchema, theme)).toBe(false);
    expect(Value.Check(UiPreferencesUpdateBodySchema, { theme })).toBe(false);
  });

  it("取得の応答は theme だけを持つ（余分な項目を含むと拒否する）", () => {
    expect(Value.Check(UiPreferencesSchema, { theme: "dark", username: "admin" })).toBe(false);
  });
});
