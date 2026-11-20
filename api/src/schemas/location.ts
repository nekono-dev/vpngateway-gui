// 責務: 接続先（ロケーション）とお気に入り操作のTypeBoxスキーマ定義。

import { Type, type Static } from "@sinclair/typebox";
import { LOCATION_ID_PATTERN } from "../locations/location-id.js";

export const LocationSchema = Type.Object({
  // 接続先の安定ID（例: "us-las-vegas"）。`PUT /v1/connection`・お気に入り操作のキー。
  id: Type.String(),
  // ISO国コード（小文字。例: "us"）。
  country: Type.String(),
  countryName: Type.String(),
  // CLIが表示する都市名。都市列を持たない一覧（国単位の一覧）では省略する。
  city: Type.Optional(Type.String()),
  // ping推定値（ミリ秒）。取得できなかった接続先では省略する。
  pingMs: Type.Optional(Type.Number()),
  // 利用者の国の首都からの距離（km。小数点以下第一位）。ping を計測できないプロバイダで、距離が決まった接続先のみ付く。
  distanceKm: Type.Optional(Type.Number()),
  favorite: Type.Boolean(),
  // 最後に接続に成功した接続先か（高々1件がtrue）。
  lastConnected: Type.Boolean(),
});
export type Location = Static<typeof LocationSchema>;

// ping昇順（pingなしは末尾）に並べて返す。
export const LocationsResponseSchema = Type.Array(LocationSchema);

// 階層ブラウザーの国行。ping は並べ替えにだけ使い、応答には含めない。
export const CountryRowSchema = Type.Object({
  id: Type.String(),
  country: Type.String(),
  countryName: Type.String(),
  hasServerStage: Type.Boolean(),
  distanceKm: Type.Optional(Type.Number()),
  favorite: Type.Boolean(),
  lastConnected: Type.Boolean(),
}, { additionalProperties: false });

// 都市行は既存の LocationSchema と同じ項目を持ち、city を必須とする。
export const CityRowSchema = Type.Object({
  id: Type.String(),
  country: Type.String(),
  countryName: Type.String(),
  city: Type.String(),
  pingMs: Type.Optional(Type.Number()),
  distanceKm: Type.Optional(Type.Number()),
  favorite: Type.Boolean(),
  lastConnected: Type.Boolean(),
}, { additionalProperties: false });
export type CityRow = Static<typeof CityRowSchema>;

export const ServerRowSchema = Type.Object({
  name: Type.String(),
  tier: Type.Union([Type.Literal("free"), Type.Literal("paid")]),
  load: Type.Number(),
  score: Type.Number(),
  favorite: Type.Boolean(),
  connected: Type.Boolean(),
}, { additionalProperties: false });
export type ServerRow = Static<typeof ServerRowSchema>;

export const FavoriteItemSchema = Type.Union([
  Type.Object({ id: Type.String(), kind: Type.Literal("city"), country: Type.String(), countryName: Type.String(), city: Type.String() }, { additionalProperties: false }),
  Type.Object({ id: Type.String(), kind: Type.Literal("server"), country: Type.String(), countryName: Type.String(), city: Type.String(), serverName: Type.String() }, { additionalProperties: false }),
]);
export type FavoriteItem = Static<typeof FavoriteItemSchema>;
// API request uses one object schema because AJV's removeAdditional behavior mutates
// union branches before checking the server variant.
export const FavoriteItemRequestSchema = Type.Object({
  id: Type.String(),
  kind: Type.Union([Type.Literal("city"), Type.Literal("server")]),
  country: Type.String(),
  countryName: Type.String(),
  city: Type.String(),
  serverName: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const FavoritesResponseSchema = Type.Array(FavoriteItemSchema);

export const CityTabSchema = Type.Union([Type.Literal("fastest"), Type.Literal("select")]);
export const CityTabResponseSchema = Type.Object({ tab: CityTabSchema }, { additionalProperties: false });
export type CityTabResponse = Static<typeof CityTabResponseSchema>;

// 再計測は国一覧を再取得した結果を返す。
export const LocationsRefreshResponseSchema = Type.Array(CountryRowSchema);

export const LocationIdParamsSchema = Type.Object({
  locationId: Type.String({ pattern: LOCATION_ID_PATTERN }),
});

export const FavoriteResponseSchema = Type.Object({
  locationId: Type.String(),
  favorite: Type.Boolean(),
});
