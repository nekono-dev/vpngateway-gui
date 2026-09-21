// 責務: Web UIから渡された値をVPNクライアント操作プロファイルのプレースホルダー許可条件（正規表現・実行時の許可値）
// に対して検証し、argv配列（実行コマンド本体）と、標準入力へ渡す文字列を解決する。
// Web UI側でドロップダウン選択に限定していてもフロントエンドを信用せず、ここで必ず再検証する。

import { matchesPattern } from "../lib/regex-match.js";
import type { VendorProfile } from "./profile.schema.js";
import { requireAction } from "./require-action.js";

export class PlaceholderValidationError extends Error {}

const PLACEHOLDER_TOKEN_PATTERN = /^%([A-Z_]+)%$/;

/**
 * 目的: 指定アクションのargvテンプレートに、検証済みの値を代入して実行可能なargv配列（コマンド本体、binaryを含まない）を解決する。
 * 入力: profile(検証済みプロファイル), actionName(実行するアクション名。プロファイルに無ければOperationUnsupportedError),
 *       values(プレースホルダー名→生の値),
 *       allowedValues(`source: "locations"`のプレースホルダー名→許可値の配列。実行時に決まる許可値を呼び出し元が渡す。省略時は空)。
 * 出力: プレースホルダーを実値に置き換えたargv配列。
 * 失敗時の方針: 未定義プレースホルダー参照・値の未指定・許可条件（正規表現/実行時の許可値）不一致の場合は
 *              PlaceholderValidationErrorを投げる（呼び出し元でHTTP 400へマッピングする）。
 *              `source: "secret"`のプレースホルダーをargvに置くことは許さない（秘密はコマンド引数に残さない）。
 * 例: resolveArgv(profile, "connect", { LOCATION: "Tokyo" }, { LOCATION: ["Tokyo", "Seoul"] }) // => ["connect", "-l", "Tokyo", "-y"]
 */
export function resolveArgv(
  profile: VendorProfile,
  actionName: keyof VendorProfile["actions"],
  values: Record<string, string>,
  allowedValues: Record<string, string[]> = {},
): string[] {
  const action = requireAction(profile, actionName);

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
    if (placeholder.source === "secret") {
      throw new PlaceholderValidationError(`secret placeholder must not be used in argv: ${placeholderKey}`);
    }

    const rawValue = values[placeholderKey];
    if (rawValue === undefined) {
      throw new PlaceholderValidationError(`missing value for placeholder: ${placeholderKey}`);
    }

    if (!matchesPattern(rawValue, placeholder.pattern)) {
      throw new PlaceholderValidationError(`value for ${placeholderKey} does not match allowed pattern`);
    }

    // 許可値の出典はプレースホルダー定義で決まる。"locations"は実行時に呼び出し元が渡した値のみ許可する。
    // "input"は許可値の列挙を持たず、上の`pattern`検証のみで受理する（ログインのユーザー名等）。
    if (placeholder.source === "locations") {
      const enumValues = allowedValues[placeholderKey];
      if (!enumValues) {
        throw new PlaceholderValidationError(`allowed values for ${placeholderKey} were not provided`);
      }
      if (!enumValues.includes(rawValue)) {
        throw new PlaceholderValidationError(`value for ${placeholderKey} is not in the allowed list`);
      }
    }

    // シェルを経由せずexecFileへ渡すargv要素になるため、追加のエスケープ処理は不要。
    return rawValue;
  });
}

/**
 * 目的: アクションの`stdin`テンプレート（行の配列）に、検証済みの秘密の値を代入し、子プロセスの標準入力へ渡す文字列を組み立てる。
 * 入力: profile(検証済みプロファイル), actionName(実行するアクション名), values(プレースホルダー名→生の値。秘密を含む)。
 *       期待する形状: `stdin`の各要素は固定の文字列、または`source: "secret"`のプレースホルダー（例 "%PASSWORD%"）。
 * 出力: 各行の末尾に改行を付けて連結した文字列。`stdin`が未定義なら undefined（標準入力を使わない）。
 *       `optional: true`のプレースホルダーは、値が未指定・空ならその行を出さない。
 * 失敗時の方針: 未定義・秘密でないプレースホルダーの参照、必須の値の未指定、`pattern`不一致は
 *              PlaceholderValidationErrorを投げる。エラーメッセージに値は含めない（秘密がエラー応答・ログへ残らないようにするため）。
 * 例: resolveStdin(profile, "login", { PASSWORD: "p", TWO_FACTOR_CODE: "123456" }) // => "p\n123456\n"
 */
export function resolveStdin(
  profile: VendorProfile,
  actionName: keyof VendorProfile["actions"],
  values: Record<string, string | undefined>,
): string | undefined {
  const action = requireAction(profile, actionName);
  if (action.stdin === undefined) return undefined;

  const lines: string[] = [];
  for (const line of action.stdin) {
    const match = PLACEHOLDER_TOKEN_PATTERN.exec(line);
    if (!match) {
      // プレースホルダートークンでなければ固定の行としてそのまま採用する。
      lines.push(line);
      continue;
    }
    const placeholderKey = match[1];
    const placeholder = action.placeholders[placeholderKey];
    if (!placeholder || placeholder.source !== "secret") {
      throw new PlaceholderValidationError(`stdin must reference a secret placeholder: ${placeholderKey}`);
    }
    const rawValue = values[placeholderKey];
    if (rawValue === undefined || rawValue === "") {
      if (placeholder.optional === true) continue;
      throw new PlaceholderValidationError(`missing value for placeholder: ${placeholderKey}`);
    }
    if (!matchesPattern(rawValue, placeholder.pattern)) {
      throw new PlaceholderValidationError(`value for ${placeholderKey} does not match allowed pattern`);
    }
    lines.push(rawValue);
  }
  return lines.map((line) => `${line}\n`).join("");
}
