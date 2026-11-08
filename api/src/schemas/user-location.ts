// 責務: 利用者の場所（距離の基点の国）の GET/PUT/DELETE /v1/user-location のリクエスト・応答の TypeBox スキーマ。

import { Type, type Static } from "@sinclair/typebox";

// 国の選択肢の一件（設定画面の一覧に出す）。
export const CountryOptionSchema = Type.Object({
  code: Type.String(),
  name: Type.String(),
});

// 利用者の場所の決定の根拠: 保存された値、ブラウザの言語設定、無し。
export const UserLocationSourceSchema = Type.Union([
  Type.Literal("saved"),
  Type.Literal("browser"),
  Type.Literal("none"),
]);

// 応答。`effective` と `source` は、この要求の Accept-Language で決める。
// 値が無いときは項目を省く（OpenAPI 3.0 で null を使わないため）。
export const UserLocationResponseSchema = Type.Object({
  saved: Type.Optional(Type.String()),
  effective: Type.Optional(Type.String()),
  source: UserLocationSourceSchema,
  countries: Type.Array(CountryOptionSchema),
});
export type UserLocationResponse = Static<typeof UserLocationResponseSchema>;

// PUT の要求。国コードは同梱データの識別キー（2〜3 文字）。既知かどうかはルートで確かめる。
export const UserLocationUpdateBodySchema = Type.Object(
  { country: Type.String({ minLength: 2, maxLength: 3 }) },
  { additionalProperties: false },
);
export type UserLocationUpdateBody = Static<typeof UserLocationUpdateBodySchema>;
