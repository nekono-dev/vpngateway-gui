// 責務: ANSIエスケープシーケンス（カーソル制御・色付け等）を文字列から除去するのみを行う汎用ヘルパー。
// プロジェクト固有の型・モジュールに依存しない。

// eslint-disable-next-line no-control-regex -- ANSIエスケープシーケンス自体を検出する目的のため意図的。
const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;

/**
 * 目的: 文字列からANSIエスケープシーケンスを除去する。
 * 入力: value(除去対象の文字列)。
 * 出力: ANSIエスケープシーケンスを取り除いた文字列。
 * 例: stripAnsi("\x1B[1mb\x1B[0m - Open link") // => "b - Open link"
 */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}
