// 責務: 正規表現マッチのみを行う汎用ヘルパー。プロジェクト固有の型・モジュールに依存しない。

/**
 * 目的: 文字列が正規表現パターンに一致するかを判定する。
 * 入力: value(検証対象の文字列), pattern(正規表現文字列、アンカー等は呼び出し元が含める)。
 * 出力: 一致すれば true。
 * 例: matchesPattern("jp", "^[a-z]{2}$") // => true
 */
export function matchesPattern(value: string, pattern: string): boolean {
  return new RegExp(pattern).test(value);
}
