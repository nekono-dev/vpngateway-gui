// 責務: プロキシから返されたコマンド実行結果(stdout)を、プロファイルの`outputFormat`に応じて
// 接続状態の構造化データへ変換する。ベンダー非依存のレスポンス整形層として、Phase 2で実CLIの
// テキスト出力パーサーを追加した（wbs/phase1.md「全体整合性レビューでの指摘」参照）。

import type { ConnectionStatus } from "../schemas/connection.js";
import { stripAnsi } from "../lib/strip-ansi.js";

/**
 * 目的: コマンド実行結果のstdoutを接続状態(ConnectionStatus)へ変換する。
 * 入力: outputFormat(プロファイルで指定された出力形式、"json"または"text"), stdout(コマンドの標準出力)。
 * 出力: 接続状態オブジェクト。
 * 失敗時の方針: 未対応のoutputFormat、またはstdoutが期待する形状でない場合は例外を投げる
 *              （呼び出し元でコマンド実行失敗と同様に扱う）。
 */
export function parseConnectionOutput(outputFormat: string, stdout: string): ConnectionStatus {
  if (outputFormat === "json") {
    return parseJsonOutput(stdout);
  }
  if (outputFormat === "text") {
    return parseTextOutput(stdout);
  }
  throw new Error(`unsupported outputFormat: ${outputFormat}`);
}

function parseJsonOutput(stdout: string): ConnectionStatus {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("vendor CLI output is not a JSON object");
  }
  const status = (parsed as Record<string, unknown>).status;
  if (status !== "connected" && status !== "disconnected") {
    throw new Error(`unexpected status value from vendor CLI output: ${String(status)}`);
  }
  const country = (parsed as Record<string, unknown>).country;
  return {
    status,
    country: typeof country === "string" ? country : undefined,
  };
}

// "disconnected"を"connected"の部分一致として誤検出しないよう、前後が英字でない箇所でのみ一致させる
// （"connected"の直前に英字があれば"disconnected"等の一部であり、単独の"connected"ではない）。
const CONNECTED_WORD_PATTERN = /(?<![a-zA-Z])connected(?![a-zA-Z])/i;

/**
 * 目的: 実VPNベンダーCLI（例: AdGuard VPN CLI）のテキスト出力から接続状態を判定する。
 * 入力: stdout(status/connect/disconnectコマンドの標準出力、exitCode=0の場合のみ呼び出される想定)。
 * 出力: 接続状態オブジェクト。
 * 実装上の制約: 実CLIのstdout書式はベンダー・バージョンにより変化しうる
 *              （サードパーティ製ラッパーの実装でも、この語のみを安定した判定基準としている実績がある）。
 *              そのため接続先国(country)は確実に抽出できる固定書式を確認できておらず取得しない
 *              （apiserver/design.md「Phase 2における具体プロファイル」参照。要実機検証）。
 */
function parseTextOutput(stdout: string): ConnectionStatus {
  const clean = stripAnsi(stdout);
  const status: ConnectionStatus["status"] = CONNECTED_WORD_PATTERN.test(clean) ? "connected" : "disconnected";
  return { status };
}

const URL_PATTERN = /https?:\/\/[^\s`'"]+/;

/**
 * 目的: `login`アクションの標準出力からログインURLを抽出する。
 * 入力: stdout(loginコマンドの標準出力。completionPatternに一致した時点までの内容)。
 * 出力: 最初に見つかったURL文字列。見つからない場合はundefined。
 * 例: extractLoginUrl("You need to authorize in your browser: https://auth.adguard.io/device_code?user_code=ABCD")
 *     // => "https://auth.adguard.io/device_code?user_code=ABCD"
 */
export function extractLoginUrl(stdout: string): string | undefined {
  const clean = stripAnsi(stdout);
  return URL_PATTERN.exec(clean)?.[0];
}
