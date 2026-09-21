// 責務: 接続先（ロケーション）とお気に入り操作のTypeBoxスキーマ定義（apiserver/design.md「接続先（ロケーション）」）。

import { Type, type Static } from "@sinclair/typebox";
import { LOCATION_ID_PATTERN } from "../locations/location-id.js";

export const LocationSchema = Type.Object({
  // 接続先の安定ID（例: "us-las-vegas"）。`PUT /v1/connection`・お気に入り操作のキー。
  id: Type.String(),
  // ISO国コード（小文字。例: "us"）。
  country: Type.String(),
  countryName: Type.String(),
  // ベンダーCLIが表示する都市名（例: "Shanghai (Virtual)"）。
  city: Type.String(),
  // ping推定値（ミリ秒）。取得できなかった接続先では省略する。
  pingMs: Type.Optional(Type.Number()),
  favorite: Type.Boolean(),
  // 最後に接続に成功した接続先か（高々1件がtrue）。
  lastConnected: Type.Boolean(),
});
export type Location = Static<typeof LocationSchema>;

// ping昇順（pingなしは末尾）に並べて返す。
export const LocationsResponseSchema = Type.Array(LocationSchema);

export const LocationIdParamsSchema = Type.Object({
  locationId: Type.String({ pattern: LOCATION_ID_PATTERN }),
});

export const FavoriteResponseSchema = Type.Object({
  locationId: Type.String(),
  favorite: Type.Boolean(),
});
