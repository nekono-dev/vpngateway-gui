// 責務: コマンド失敗時にユーザへ返す診断テキストを、stderr/stdoutから選ぶ汎用ヘルパー。
// VPNベンダーCLIの中にはエラーメッセージをstderrではなくstdoutへ出力するものがあるため
// （例: `disconnect`が接続していない時の"Failed to disconnect. Process is not running"、exit code 14。
//  Phase 5のE2Eで判明）、stderrのみを返すと診断が空になる。プロジェクト固有の型に依存しない。

import { stripAnsi } from "./strip-ansi.js";

/**
 * 目的: 失敗したコマンドの出力から、ユーザへ返す診断テキストを選ぶ。
 * 入力: stderr(標準エラー出力), stdout(標準出力)。いずれも空文字列でよい。
 * 出力: ANSIエスケープを除去して前後の空白を除いたstderr。それが空ならstdout。どちらも空なら空文字列。
 * 例: pickFailureOutput("", "Failed to disconnect. Process is not running\n") // => "Failed to disconnect. Process is not running"
 */
export function pickFailureOutput(stderr: string, stdout: string): string {
  const cleanedStderr = stripAnsi(stderr).trim();
  return cleanedStderr.length > 0 ? cleanedStderr : stripAnsi(stdout).trim();
}
