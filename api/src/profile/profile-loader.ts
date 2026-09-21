// 責務: 管理者向け設定「VPNクライアント操作プロファイル」JSONファイル1つの読み込み・検証。
// 複数ベンダーのプロファイルの管理（有効なものの読み込み・選択中のベンダー）は providers/provider-registry.ts が担う
// （Phase 11。ここはファイル1つの解釈だけを行う）。

import { readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { VendorProfileSchema, type LoginMethod, type VendorProfile } from "./profile.schema.js";

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

/**
 * 目的: スキーマ検証済みのプロファイルに対し、スキーマでは表せない組合せ制約と正規表現の妥当性を検証する。
 * 入力: profile(スキーマ検証済み)。
 * 出力: なし。
 * 失敗時の方針: 違反があれば例外を投げ、起動を失敗させる（不正な管理者向け設定のまま誤ったコマンドを
 *              解決しないため）。制約: `connect`と`connectAuto`の少なくとも一方が必要（接続手段が無いプロバイダは成立しない）。
 * 例: validateProfile(profile) // 問題なければ何も返さない
 */
export function validateProfile(profile: VendorProfile): void {
  const { actions } = profile;
  if (actions.connect === undefined && actions.connectAuto === undefined) {
    throw new Error('invalid vendor profile: at least one of "connect" and "connectAuto" is required');
  }
  for (const [name, action] of Object.entries(actions)) {
    // 省略可のアクションは未定義でありうる（JSONに無い場合だけでなく、テスト等でundefinedを明示する場合もある）。
    if (action === undefined) continue;
    assertValidRegExp(`${name}.completionPattern`, action.completionPattern);
    assertValidRegExp(`${name}.restrictedPattern`, action.restrictedPattern);
  }
  assertValidRegExp("output.locationPattern", profile.output?.locationPattern, "im");
  const account = actions.account;
  if (account) {
    assertValidRegExp("account.notLoggedInPattern", account.notLoggedInPattern);
    for (const plan of account.plans) {
      assertValidRegExp(`account.plans[${plan.id}].pattern`, plan.pattern);
    }
  }
}

/**
 * 目的: プロファイルのログイン方式を返す（未指定は従来のURL提示型）。
 * 入力: profile(検証済みプロファイル)。
 * 出力: "deviceUrl" または "credentials"。
 * 例: getLoginMethod({ ...profile, loginMethod: undefined }) // => "deviceUrl"
 */
export function getLoginMethod(profile: VendorProfile): LoginMethod {
  return profile.loginMethod ?? "deviceUrl";
}

/**
 * 目的: プロファイルJSONファイルを読み込み、スキーマ・組合せ制約を検証して返す。
 * 入力: path(プロファイルJSONのパス)。
 * 出力: 検証済みのVendorProfile。
 * 失敗時の方針: JSONパース失敗・スキーマ不一致・組合せ制約違反の場合は例外を投げ、アプリケーション起動を失敗させる
 *              （不正な管理者向け設定のまま起動を続けると、誤ったコマンドを解決しかねないため）。
 * 例: const profile = parseProfileFile("/etc/vpngwgui/profiles/adguardvpn.json");
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
