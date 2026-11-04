// 責務: 表示設定（テーマ）の値の集合と、`GET/PUT /v1/ui-preferences` のリクエスト・応答のTypeBoxスキーマ定義。
// テーマの値は「OS 規定（system）」「ライト（light）」「ダーク（dark）」の3種類に限る。

import { Type, type Static } from "@sinclair/typebox";

export const ThemePreferenceSchema = Type.Union([
  Type.Literal("system"),
  Type.Literal("light"),
  Type.Literal("dark"),
]);
export type ThemePreference = Static<typeof ThemePreferenceSchema>;

// `GET /v1/ui-preferences` の応答（未ログインでも返す。テーマの値だけを含み、他の項目は持たない）。
export const UiPreferencesSchema = Type.Object(
  { theme: ThemePreferenceSchema },
  { additionalProperties: false },
);
export type UiPreferences = Static<typeof UiPreferencesSchema>;

// `PUT /v1/ui-preferences` の要求。
export const UiPreferencesUpdateBodySchema = Type.Object(
  { theme: ThemePreferenceSchema },
  { additionalProperties: false },
);
export type UiPreferencesUpdateBody = Static<typeof UiPreferencesUpdateBodySchema>;
