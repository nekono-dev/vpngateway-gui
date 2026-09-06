// 責務: 接続状態・接続操作に関するリクエスト/レスポンスのTypeBoxスキーマ定義。
// このスキーマがそのまま実装の型定義とOpenAPI仕様の唯一の情報源になる。

import { Type, type Static } from "@sinclair/typebox";

export const ConnectionStatusSchema = Type.Object({
  status: Type.Union([Type.Literal("connected"), Type.Literal("disconnected")]),
  country: Type.Optional(Type.String()),
});
export type ConnectionStatus = Static<typeof ConnectionStatusSchema>;

export const ConnectionPutBodySchema = Type.Object({
  connect: Type.Boolean(),
  country: Type.Optional(Type.String()),
});
export type ConnectionPutBody = Static<typeof ConnectionPutBodySchema>;

export const CountriesResponseSchema = Type.Array(Type.String());

export const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  exitCode: Type.Optional(Type.Number()),
  stderr: Type.Optional(Type.String()),
});
