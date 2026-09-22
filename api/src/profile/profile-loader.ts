// 責務: 管理者向け設定「VPNクライアント操作プロファイル」JSONファイル1つの読み込み・検証。
// 複数ベンダーのプロファイルの管理（有効なものの読み込み・選択中のベンダー）は providers/provider-registry.ts が担う
// （Phase 11。ここはファイル1つの解釈だけを行う）。

import { readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { VendorProfileSchema, type VendorProfile } from "./profile.schema.js";

/**
 * 目的: 正規表現文字列がコンパイルできることを確認する（ロード時に不正なプロファイルを弾くため）。
 * 入力: label(エラーメッセージ用の項目名), pattern(検証する正規表現ソース。undefinedなら何もしない), flags(省略可)。
 * 出力: なし。失敗時は例外を投げる。
 */
function assertValidRegExp(label: string, pattern: string | undefined, flags?: string): void {
  if (pattern === undefined) return;
  try {
    new RegExp(pattern, flags);
  } catch {
    throw new Error(`invalid regular expression in profile (${label}): ${pattern}`);
  }
}

// `secret`のプレースホルダーの`pattern`が受理してはならない値の例（標準入力へ余分な行を混入させる改行・NUL・制御文字）。
// 制御文字そのものを扱うため、エスケープで書く。
const SECRET_FORBIDDEN_SAMPLES = ["a\nb", "a\rb", "a\u0000b", "a\u007fb", "\n"];

const PLACEHOLDER_TOKEN = /^%([A-Z_]+)%$/;

/**
 * 目的: スキーマ検証済みのプロファイルに対し、スキーマでは表せない組合せ制約と正規表現の妥当性を検証する。
 * 入力: profile(スキーマ検証済み)。
 * 出力: なし。
 * 失敗時の方針: 違反があれば例外を投げ、起動を失敗させる（不正な管理者向け設定のまま誤ったコマンドを
 *              解決しないため）。制約:
 *              - `connect`と`connectAuto`の少なくとも一方が必要（接続手段が無いプロバイダは成立しない）。
 *              - text形式では`output.connectedPattern`・`output.locationPattern`が必要（コード側に既定の書式を持たないため）。
 *              - `source: "secret"`のプレースホルダーは、argvに置かず、`pattern`が改行・制御文字を許さないこと。
 *              - `loginMethod: "credentials"`の`login`は、`stdin`を宣言し、`stdin`の`%KEY%`は`secret`のプレースホルダーであること。
 * 例: validateProfile(profile) // 問題なければ何も返さない
 */
export function validateProfile(profile: VendorProfile): void {
  const { actions } = profile;
  if (actions.connect === undefined && actions.connectAuto === undefined) {
    throw new Error('invalid vendor profile: at least one of "connect" and "connectAuto" is required');
  }
  if (profile.outputFormat === "text") {
    if (profile.output?.connectedPattern === undefined || profile.output?.locationPattern === undefined) {
      throw new Error('invalid vendor profile: "output.connectedPattern" and "output.locationPattern" are required when outputFormat is "text"');
    }
  }
  for (const [name, action] of Object.entries(actions)) {
    // 省略可のアクションは未定義でありうる（JSONに無い場合だけでなく、テスト等でundefinedを明示する場合もある）。
    if (action === undefined) continue;
    assertValidRegExp(`${name}.completionPattern`, action.completionPattern);
    assertValidRegExp(`${name}.restrictedPattern`, action.restrictedPattern);
    assertValidRegExp(`${name}.successPattern`, action.successPattern, "m");
    assertValidSecretPlaceholders(name, action);
  }
  assertValidRegExp("output.connectedPattern", profile.output?.connectedPattern, "i");
  assertValidRegExp("output.locationPattern", profile.output?.locationPattern, "im");
  assertValidRegExp("listLocations.connectName.stripPattern", actions.listLocations?.connectName.stripPattern);
  if (profile.loginMethod === "credentials") {
    if (actions.login !== undefined && actions.login.stdin === undefined) {
      throw new Error('invalid vendor profile: "login.stdin" is required when loginMethod is "credentials"');
    }
  }
  const account = actions.account;
  if (account) {
    assertValidRegExp("account.notLoggedInPattern", account.notLoggedInPattern);
    for (const plan of account.plans) {
      assertValidRegExp(`account.plans[${plan.id}].pattern`, plan.pattern);
      assertValidRegExp(`account.plans[${plan.id}].usageNote.pattern`, plan.usageNote?.pattern, "im");
    }
  }
}

/**
 * 目的: アクションの`secret`のプレースホルダーと`stdin`の組合せ制約を検証する。
 * 入力: name(アクション名。エラーメッセージ用), action(検証するアクション定義)。
 * 出力: なし。違反があれば例外を投げる（argvへ秘密を置く・制御文字を許すパターン・未定義や秘密でないプレースホルダーの参照）。
 */
function assertValidSecretPlaceholders(name: string, action: VendorProfile["actions"]["disconnect"]): void {
  const secretKeys = Object.entries(action.placeholders)
    .filter(([, placeholder]) => placeholder.source === "secret")
    .map(([key]) => key);
  for (const key of secretKeys) {
    if (action.argv.includes(`%${key}%`)) {
      throw new Error(`invalid vendor profile: secret placeholder "${key}" must not appear in ${name}.argv`);
    }
    const pattern = action.placeholders[key].pattern;
    assertValidRegExp(`${name}.placeholders.${key}.pattern`, pattern);
    if (SECRET_FORBIDDEN_SAMPLES.some((sample) => new RegExp(pattern).test(sample))) {
      throw new Error(`invalid vendor profile: pattern of secret placeholder "${key}" must reject newlines and control characters`);
    }
  }
  for (const line of action.stdin ?? []) {
    const key = PLACEHOLDER_TOKEN.exec(line)?.[1];
    if (key !== undefined && !secretKeys.includes(key)) {
      throw new Error(`invalid vendor profile: ${name}.stdin references "${key}", which is not a secret placeholder`);
    }
  }
}

/**
 * 目的: プロファイルJSONファイルを読み込み、スキーマ・組合せ制約を検証して返す。
 * 入力: path(プロファイルJSONのパス)。
 * 出力: 検証済みのVendorProfile。
 * 失敗時の方針: JSONパース失敗・スキーマ不一致・組合せ制約違反の場合は例外を投げ、アプリケーション起動を失敗させる
 *              （不正な管理者向け設定のまま起動を続けると、誤ったコマンドを解決しかねないため）。
 * 例: const profile = parseProfileFile("/etc/vpngwgui/vendors/<ベンダーID>/profile.json");
 */
export function parseProfileFile(path: string): VendorProfile {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Value.Check(VendorProfileSchema, raw)) {
    const errors = [...Value.Errors(VendorProfileSchema, raw)].slice(0, 5);
    throw new Error(`invalid vendor profile at ${path}: ${JSON.stringify(errors)}`);
  }
  validateProfile(raw);
  return raw;
}
