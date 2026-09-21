// 責務: 管理者向け設定「VPNクライアント操作プロファイル」JSONのTypeBoxスキーマ定義。
// apiserver/design.md「管理者向け設定」「Phase 9における具体プロファイル」参照。
// argv配列ベースで保持し、シェル文字列は扱わない。プロバイダごとの機能差・プラン制限もここ（データ）で表現する。

import { Type, type Static } from "@sinclair/typebox";
import { OPERATION_KEYS } from "../capabilities/operations.js";

// 許可値の出典。
// - "enum": プロファイル内の配列フィールド（`enumFrom`。例 "adguardvpn.regions"）に含まれる値のみ許可する。
// - "locations": 直前に`listLocations`アクションで取得した接続先から導出した値のみ許可する（Phase 8。
//   許可値は実行時に決まるため、resolveArgvの呼び出し元が渡す。apiserver/design.md「Phase 8における具体プロファイル」）。
// - "input": 利用者入力を`pattern`のみで検証して使う（Phase 9。ログインのユーザー名。許可値の列挙が意味を持たない入力用）。
export const PlaceholderDefSchema = Type.Object({
  pattern: Type.String(),
  source: Type.Union([Type.Literal("enum"), Type.Literal("locations"), Type.Literal("input")]),
  enumFrom: Type.Optional(Type.String()),
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
  // コマンドが失敗したとき、標準出力・標準エラーがこの正規表現に一致すればプラン制限による失敗とみなす
  // （Phase 9。403 operation_restrictedで通知し、対応するオペレーションを制限として学習する）。
  restrictedPattern: Type.Optional(Type.String()),
  // 終了コードが0以外でも、標準出力・標準エラーがこの正規表現に一致すれば成功とみなす。
  // Proton VPN CLIの`disconnect`は、実際の接続の切断に成功しても終了コード1で"Disconnected."と出力するため。
  successPattern: Type.Optional(Type.String()),
});
export type ActionDef = Static<typeof ActionDefSchema>;

// `listLocations`アクション。出力表の列名と、接続時の指定名の出典をプロバイダごとに指定できる（Phase 9）。
export const ListLocationsActionDefSchema = Type.Composite([
  ActionDefSchema,
  Type.Object({
    // 出力表のヘッダ行に現れる列名。`iso`・`country`は必須、`city`・`ping`は省略可。省略時は従来のAdGuard VPN形式
    // （ISO/COUNTRY/CITY/PING）。
    table: Type.Optional(
      Type.Object({
        iso: Type.String(),
        country: Type.String(),
        city: Type.Optional(Type.String()),
        ping: Type.Optional(Type.String()),
      }),
    ),
    // `%LOCATION%`へ代入する接続時の指定名の出典。"city"（既定。都市名から"(Virtual)"を除いたもの）／"iso"（ISO国コード）。
    connectNameFrom: Type.Optional(Type.Union([Type.Literal("city"), Type.Literal("iso")])),
  }),
]);
export type ListLocationsActionDef = Static<typeof ListLocationsActionDefSchema>;

// 契約プランの定義。`account`の出力が`pattern`に一致したときそのプランと判定し、`restricts`のオペレーションを制限する。
export const PlanDefSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  pattern: Type.String(),
  restricts: Type.Array(Type.Union(OPERATION_KEYS.map((key) => Type.Literal(key)))),
  // 制限理由として画面に出す文。省略時は「現在のプラン（<label>）では利用できません」。
  restrictionMessage: Type.Optional(Type.String()),
  // このプランで接続できる接続先（国・都市）の参考一覧の出典（Phase 14）。CLIが接続先を指定させないプランでも、
  // 「自動接続でどこへ繋がりうるか」を画面に出すため、CLIがキャッシュしたサーバ一覧（JSON）を宣言に従って読む。
  availableLocations: Type.Optional(
    Type.Object({
      // `<PROVIDER_CACHE_DIR>/<ベンダーID>/`からの相対パス。
      file: Type.String({ minLength: 1 }),
      // サーバの配列を持つ最上位のキー、各サーバの国コード・都市名の項目名。
      list: Type.String({ minLength: 1 }),
      country: Type.String({ minLength: 1 }),
      city: Type.Optional(Type.String({ minLength: 1 })),
      // 当該プランで使えるサーバの条件（全て満たすもの）。
      where: Type.Optional(
        Type.Array(Type.Object({ field: Type.String({ minLength: 1 }), equals: Type.Union([Type.String(), Type.Number()]) })),
      ),
      // 国コードの読み替え（ISO 3166-1と異なる独自コードの名称解決用）。
      countryAliases: Type.Optional(Type.Record(Type.String(), Type.String())),
    }),
  ),
});
export type PlanDef = Static<typeof PlanDefSchema>;

// `account`アクション。ログイン状態・プランを判定する副作用のない読み取り専用コマンド
// （apiserver/design.md「ログイン状態・プランの判定」）。
export const AccountActionDefSchema = Type.Composite([
  ActionDefSchema,
  Type.Object({
    // 出力（終了コードを問わない）がこれに一致すれば未ログイン。
    notLoggedInPattern: Type.Optional(Type.String()),
    plans: Type.Array(PlanDefSchema),
    // どの`plans`にも一致しなかったときのプラン。
    defaultPlan: Type.Object({ id: Type.String(), label: Type.String() }),
  }),
]);
export type AccountActionDef = Static<typeof AccountActionDefSchema>;

// Phase 1では"json"固定（モックCLI）。Phase 2で実VPNベンダーCLI統合に伴い"text"を追加し、
// 対応するパーサーをresponse-parser.tsに実装した（wbs/phase2.md参照）。
export const OutputFormatSchema = Type.Union([Type.Literal("json"), Type.Literal("text")]);

// ログイン方式。"deviceUrl"=`login`が認証URLを出力する（AdGuard VPN。既定）、
// "credentials"=ユーザー名・パスワード（・2FAコード）の入力型（Proton VPN）。
export const LoginMethodSchema = Type.Union([Type.Literal("deviceUrl"), Type.Literal("credentials")]);
export type LoginMethod = Static<typeof LoginMethodSchema>;

export const VendorProfileSchema = Type.Object({
  vendor: Type.String(),
  // 画面に出すベンダー名（Phase 11）。省略時は`vendor`。
  displayName: Type.Optional(Type.String()),
  binary: Type.String(),
  outputFormat: OutputFormatSchema,
  loginMethod: Type.Optional(LoginMethodSchema),
  // 接続状態のテキスト出力の解釈（Phase 9）。省略時は従来のAdGuard VPN形式。
  output: Type.Optional(
    Type.Object({
      // 接続先（表示名）を取り出す正規表現（フラグim。第1キャプチャが接続先）。
      locationPattern: Type.Optional(Type.String()),
    }),
  ),
  // プロバイダの機能対応（Phase 9。省略時はtrue）。falseなら該当オペレーションを`unsupported`として扱う。
  features: Type.Optional(
    Type.Object({
      changeLocation: Type.Optional(Type.Boolean()),
      locationPing: Type.Optional(Type.Boolean()),
    }),
  ),
  actions: Type.Object({
    // 接続先を指定する接続（`%LOCATION%`を含む）。`listLocations`と組で`connectToLocation`になる。
    // Phase 9で省略可に変更（`connectAuto`のみのプロバイダに対応）。
    connect: Type.Optional(ActionDefSchema),
    // 接続先を指定しない接続（プロバイダが最速・既定のサーバを選ぶ。Phase 9で追加）。
    connectAuto: Type.Optional(ActionDefSchema),
    disconnect: ActionDefSchema,
    status: ActionDefSchema,
    // ログイン代行（`POST /v1/session`）用アクション。Phase 2で追加、Phase 9で省略可に変更。
    login: Type.Optional(ActionDefSchema),
    // ログアウト（`DELETE /v1/session`）用アクション（Phase 9で追加）。
    logout: Type.Optional(ActionDefSchema),
    // 接続先一覧（`list-locations`）の取得アクション。Phase 8で追加（静的な`countries`一覧を廃止した代わり）、
    // Phase 9で省略可に変更。
    listLocations: Type.Optional(ListLocationsActionDefSchema),
    // ログイン状態・プランの判定（Phase 9で追加）。
    account: Type.Optional(AccountActionDefSchema),
  }),
});
export type VendorProfile = Static<typeof VendorProfileSchema>;
