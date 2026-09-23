// 責務: TypeBoxスキーマへnull許容を付与する汎用ヘルパー。
// OpenAPI 3.0は`type: "null"`を許可しないため（`anyOf`に`{type: "null"}`を含めるとswagger schema validationが失敗する）、
// `Type.Union([schema, Type.Null()])`は使わず、`nullable: true`を付けた単一スキーマとして表現する。
import { Type, type TSchema, type Static } from "@sinclair/typebox";

/**
 * 目的: 指定したTypeBoxスキーマに、OpenAPI 3.0互換のnull許容（`nullable: true`）を付与する。
 * 入力: schema(元となるTypeBoxスキーマ)。
 * 出力: `Static<T> | null`型を持つ、`nullable: true`付きのスキーマ。
 * 例: Nullable(Type.Object({ foo: Type.String() })) // { foo: string } | null を表す
 */
export function Nullable<T extends TSchema>(schema: T): TSchema & { static: Static<T> | null } {
  return Type.Unsafe<Static<T> | null>({ ...schema, nullable: true });
}
