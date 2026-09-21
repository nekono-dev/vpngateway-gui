// 責務: プロキシから返されたコマンド実行結果(stdout)を、プロファイルの`outputFormat`に応じて
// 接続状態の構造化データへ変換する。ベンダー非依存のレスポンス整形層として、Phase 2で実CLIの
// テキスト出力パーサーを追加した（wbs/phase1.md「全体整合性レビューでの指摘」参照）。

import type { ConnectionStatus } from "../schemas/connection.js";
import { stripAnsi } from "../lib/strip-ansi.js";

/**
 * 目的: コマンド実行結果のstdoutを接続状態(ConnectionStatus)へ変換する。
 * 入力: outputFormat(プロファイルで指定された出力形式、"json"または"text"), stdout(コマンドの標準出力),
 *       options.locationPattern(省略可。"text"形式で接続先（表示名）を取り出す正規表現ソース。フラグim。
 *       第1キャプチャが接続先。省略時は従来のAdGuard VPN形式。プロファイルの`output.locationPattern`)。
 * 出力: 接続状態オブジェクト。
 * 失敗時の方針: 未対応のoutputFormat、またはstdoutが期待する形状でない場合は例外を投げる
 *              （呼び出し元でコマンド実行失敗と同様に扱う）。
 */
export function parseConnectionOutput(
  outputFormat: string,
  stdout: string,
  options: { locationPattern?: string } = {},
): ConnectionStatus {
  if (outputFormat === "json") {
    return parseJsonOutput(stdout);
  }
  if (outputFormat === "text") {
    return parseTextOutput(stdout, options.locationPattern);
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

// 接続先の都市名を取り出す。`status`は"Connected to TOKYO in TUN mode, running on tun0"、
// `connect`は"Successfully Connected to TOKYO"の形式（いずれもANSI除去後）。都市名は空白を含みうる
// （例: "NEW YORK"）ため、" in <MODE> mode"または行末までを最短一致で取る。
const DEFAULT_LOCATION_PATTERN = /(?<![a-zA-Z])Connected to (.+?)(?: in \S+ mode|\s*$)/im;

/**
 * 目的: 実VPNベンダーCLI（例: AdGuard VPN CLI）のテキスト出力から接続状態を判定する。
 * 入力: stdout(status/connect/disconnectコマンドの標準出力、exitCode=0の場合のみ呼び出される想定)。
 * 出力: 接続状態オブジェクト。接続中で接続先の都市名が読み取れれば`location`を含める。
 * 実装上の制約: 実CLIのstdout書式はベンダー・バージョンにより変化しうる
 *              （サードパーティ製ラッパーの実装でも、この語のみを安定した判定基準としている実績がある）。
 *              接続状態は"connected"という語の有無のみで判定し、都市名（`location`）は取れれば付与する
 *              補助情報とする（取れなくても状態判定には影響しない）。CLIは国コードを出力しないため、
 *              国コード(country)はここでは取得しない（接続時に要求した国をroutes/connection.tsが永続化する。
 *              apiserver/design.md「接続先国の永続化」参照）。
 */
function parseTextOutput(stdout: string, locationPattern?: string): ConnectionStatus {
  const clean = stripAnsi(stdout);
  if (!CONNECTED_WORD_PATTERN.test(clean)) {
    return { status: "disconnected" };
  }
  // Proton VPN等はプロファイルで接続先の書式を指定する（`Server: <名> in <都市>, <国>`／`Connected to <名> ...`）。
  const pattern = locationPattern === undefined ? DEFAULT_LOCATION_PATTERN : new RegExp(locationPattern, "im");
  const location = pattern.exec(clean)?.[1]?.trim();
  return location ? { status: "connected", location } : { status: "connected" };
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
