// 責務: 管理者向け設定「VPNクライアント操作プロファイル」JSONのTypeBoxスキーマ定義。
// apiserver/design.md「管理者向け設定」参照。argv配列ベースで保持し、シェル文字列は扱わない。

import { Type, type Static } from "@sinclair/typebox";

export const PlaceholderDefSchema = Type.Object({
  pattern: Type.String(),
  source: Type.Literal("enum"),
  enumFrom: Type.String(),
});

export const ActionDefSchema = Type.Object({
  argv: Type.Array(Type.String()),
  placeholders: Type.Record(Type.String(), PlaceholderDefSchema),
  timeoutMs: Type.Number(),
  // 設定されている場合、プロセスの終了を待たずstdoutがこの正規表現(文字列)に一致した時点で応答し、
  // プロセス自体はプロキシ側でバックグラウンド実行を継続させる。
  // ログイン代行（`login`アクション）のように、ブラウザでの認証完了まで数分かかる長時間プロセスに対応するための拡張点
  // （proxyserver/design.md「実VPNベンダーCLI統合・ログイン代行 (Phase 2)」参照）。
  completionPattern: Type.Optional(Type.String()),
});
export type ActionDef = Static<typeof ActionDefSchema>;

// Phase 1では"json"固定（モックCLI）。Phase 2で実VPNベンダーCLI統合に伴い"text"を追加し、
// 対応するパーサーをresponse-parser.tsに実装した（wbs/phase2.md参照）。
export const OutputFormatSchema = Type.Union([Type.Literal("json"), Type.Literal("text")]);

export const VendorProfileSchema = Type.Object({
  vendor: Type.String(),
  binary: Type.String(),
  outputFormat: OutputFormatSchema,
  actions: Type.Object({
    connect: ActionDefSchema,
    disconnect: ActionDefSchema,
    status: ActionDefSchema,
    // ログイン代行（`POST /v1/session`）用アクション。Phase 2で追加。
    login: ActionDefSchema,
  }),
  countries: Type.Array(Type.String()),
});
export type VendorProfile = Static<typeof VendorProfileSchema>;
