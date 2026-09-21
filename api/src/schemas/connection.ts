// 責務: 接続状態・接続操作に関するリクエスト/レスポンスのTypeBoxスキーマ定義。
// このスキーマがそのまま実装の型定義とOpenAPI仕様の唯一の情報源になる。

import { Type, type Static } from "@sinclair/typebox";
import { LOCATION_ID_PATTERN } from "../locations/location-id.js";

export const ConnectionStatusSchema = Type.Object({
  status: Type.Union([Type.Literal("connected"), Type.Literal("disconnected")]),
  // 接続時に要求した国コード（例: "jp"）。APIが接続成功時に永続化した値で、接続先が変わっていれば返さない。
  country: Type.Optional(Type.String()),
  // 実CLIが報告する接続先（都市名。例: "TOKYO"）。国コードとは別に、実際の接続先を示す。
  location: Type.Optional(Type.String()),
  // 接続時に要求した接続先のID（例: "jp-tokyo"。`GET /v1/connection/locations`の`id`）。`country`と同様、
  // APIが保存した値で、接続先が変わっていれば返さない。Web UIが「現在の接続先」を特定するために使う。
  locationId: Type.Optional(Type.String()),
});
export type ConnectionStatus = Static<typeof ConnectionStatusSchema>;

export const ConnectionPutBodySchema = Type.Object({
  connect: Type.Boolean(),
  // 接続先のID（`GET /v1/connection/locations`の`id`）。`connect=true`のとき必須。接続中に別のIDで呼ぶと接続先を変更する。
  locationId: Type.Optional(Type.String({ pattern: LOCATION_ID_PATTERN })),
});
export type ConnectionPutBody = Static<typeof ConnectionPutBodySchema>;

export const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  exitCode: Type.Optional(Type.Number()),
  stderr: Type.Optional(Type.String()),
});
