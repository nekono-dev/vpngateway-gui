// 責務: Web UIから渡された値をVPNクライアント操作プロファイルのプレースホルダー許可条件（正規表現・列挙値）
// に対して検証し、argv配列（実行コマンド本体）を解決する。
// Web UI側でドロップダウン選択に限定していてもフロントエンドを信用せず、ここで必ず再検証する。

import { matchesPattern } from "../lib/regex-match.js";
import type { VendorProfile } from "./profile.schema.js";

export class PlaceholderValidationError extends Error {}

const PLACEHOLDER_TOKEN_PATTERN = /^%([A-Z_]+)%$/;

/**
 * 目的: プロファイルの`enumFrom`（例 "adguardvpn.countries"）が指す列挙値配列を解決する。
 * 入力: profile(検証済みプロファイル), enumFrom(vendor名.フィールド名 の形式の文字列)。
 * 出力: 列挙値の文字列配列。
 * 失敗時の方針: vendor名不一致・フィールド未存在の場合は例外を投げる（プロファイル自体の設定不整合のため）。
 */
function resolveEnumFrom(profile: VendorProfile, enumFrom: string): string[] {
  const [vendorName, fieldName] = enumFrom.split(".");
  if (vendorName !== profile.vendor) {
    throw new Error(`enumFrom vendor mismatch: expected "${profile.vendor}", got "${vendorName}" in "${enumFrom}"`);
  }
  const value = (profile as unknown as Record<string, unknown>)[fieldName];
  if (!Array.isArray(value)) {
    throw new Error(`enumFrom field not found or not an array: "${enumFrom}"`);
  }
  return value as string[];
}

/**
 * 目的: 指定アクション（connect/disconnect/status）のargvテンプレートに、検証済みの値を代入して
 *       実行可能なargv配列（コマンド本体、binaryを含まない）を解決する。
 * 入力: profile(検証済みプロファイル), actionName(実行するアクション名), values(プレースホルダー名→生の値)。
 * 出力: プレースホルダーを実値に置き換えたargv配列。
 * 失敗時の方針: 未定義プレースホルダー参照・値の未指定・許可条件（正規表現/列挙値）不一致の場合は
 *              PlaceholderValidationErrorを投げる（呼び出し元でHTTP 400へマッピングする）。
 * 例: resolveArgv(profile, "connect", { COUNTRY: "jp" }) // => ["connection", "-l", "jp"]
 */
export function resolveArgv(
  profile: VendorProfile,
  actionName: keyof VendorProfile["actions"],
  values: Record<string, string>,
): string[] {
  const action = profile.actions[actionName];

  return action.argv.map((token) => {
    const match = PLACEHOLDER_TOKEN_PATTERN.exec(token);
    if (!match) {
      // プレースホルダートークンでなければ固定引数としてそのまま採用する。
      return token;
    }

    const placeholderKey = match[1];
    const placeholder = action.placeholders[placeholderKey];
    if (!placeholder) {
      throw new PlaceholderValidationError(`unknown placeholder: ${placeholderKey}`);
    }

    const rawValue = values[placeholderKey];
    if (rawValue === undefined) {
      throw new PlaceholderValidationError(`missing value for placeholder: ${placeholderKey}`);
    }

    if (!matchesPattern(rawValue, placeholder.pattern)) {
      throw new PlaceholderValidationError(`value for ${placeholderKey} does not match allowed pattern`);
    }

    const enumValues = resolveEnumFrom(profile, placeholder.enumFrom);
    if (!enumValues.includes(rawValue)) {
      throw new PlaceholderValidationError(`value for ${placeholderKey} is not in the allowed list`);
    }

    // シェルを経由せずexecFileへ渡すargv要素になるため、追加のエスケープ処理は不要。
    return rawValue;
  });
}
