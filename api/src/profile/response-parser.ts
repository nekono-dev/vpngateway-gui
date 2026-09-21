// 責務: プロキシから返されたコマンド実行結果(stdout)を、プロファイルの`outputFormat`に応じて
// 接続状態の構造化データへ変換する。ベンダー非依存のレスポンス整形層で、テキスト出力の書式は
// プロファイルの`output`の正規表現から受け取る（コードに既定の書式を持たない。Phase 12）。

import type { ConnectionStatus } from "../schemas/connection.js";
import { stripAnsi } from "../lib/strip-ansi.js";

/**
 * 目的: コマンド実行結果のstdoutを接続状態(ConnectionStatus)へ変換する。
 * 入力: outputFormat(プロファイルで指定された出力形式、"json"または"text"), stdout(コマンドの標準出力),
 *       options(プロファイルの`output`。"text"形式では`connectedPattern`（接続中の判定。フラグi）と
 *       `locationPattern`（接続先の表示名を第1キャプチャで取り出す。フラグim）が必須)。
 * 出力: 接続状態オブジェクト。
 * 失敗時の方針: 未対応のoutputFormat、"text"形式で正規表現が未指定、またはstdoutが期待する形状でない場合は例外を投げる
 *              （呼び出し元でコマンド実行失敗と同様に扱う）。
 */
export function parseConnectionOutput(
  outputFormat: string,
  stdout: string,
  options: { connectedPattern?: string; locationPattern?: string } = {},
): ConnectionStatus {
  if (outputFormat === "json") {
    return parseJsonOutput(stdout);
  }
  if (outputFormat === "text") {
    return parseTextOutput(stdout, options);
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

/**
 * 目的: CLIのテキスト出力から接続状態を判定する。判定と接続先の取り出しは、プロファイルの正規表現に従う（コードは書式を持たない）。
 * 入力: stdout(status/connect/disconnectコマンドの標準出力、exitCode=0の場合のみ呼び出される想定),
 *       patterns(`connectedPattern`・`locationPattern`。両方必須)。
 * 出力: 接続状態オブジェクト。接続中で接続先の表示名が読み取れれば`location`を含める。
 * 実装上の制約: 接続状態は`connectedPattern`の一致の有無のみで判定し、接続先（`location`）は取れれば付与する
 *              補助情報とする（取れなくても状態判定には影響しない）。CLIは国コードを出力しない前提のため、
 *              国コード(country)はここでは取得しない（接続時に要求した国をroutes/connection.tsが永続化する。
 *              apiserver/design.md「接続先国の永続化」参照）。
 */
function parseTextOutput(
  stdout: string,
  patterns: { connectedPattern?: string; locationPattern?: string },
): ConnectionStatus {
  if (patterns.connectedPattern === undefined || patterns.locationPattern === undefined) {
    throw new Error('outputFormat "text" requires output.connectedPattern and output.locationPattern');
  }
  const clean = stripAnsi(stdout);
  if (!new RegExp(patterns.connectedPattern, "i").test(clean)) {
    return { status: "disconnected" };
  }
  const location = new RegExp(patterns.locationPattern, "im").exec(clean)?.[1]?.trim();
  return location ? { status: "connected", location } : { status: "connected" };
}

const URL_PATTERN = /https?:\/\/[^\s`'"]+/;

/**
 * 目的: `login`アクションの標準出力からログインURLを抽出する。
 * 入力: stdout(loginコマンドの標準出力。completionPatternに一致した時点までの内容)。
 * 出力: 最初に見つかったURL文字列。見つからない場合はundefined。
 * 例: extractLoginUrl("Open in your browser: https://auth.example.test/device?code=ABCD")
 *     // => "https://auth.example.test/device?code=ABCD"
 */
export function extractLoginUrl(stdout: string): string | undefined {
  const clean = stripAnsi(stdout);
  return URL_PATTERN.exec(clean)?.[0];
}
