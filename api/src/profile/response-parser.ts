// 責務: プロキシから返されたコマンド実行結果(stdout)を、プロファイルの`outputFormat`に応じて
// 接続状態の構造化データへ変換する。ベンダー非依存のレスポンス整形層として、Phase 4で実CLIの
// テキスト出力パーサーを追加する際にここへパーサーを追加するだけで済むようにする
// （wbs/phase1.md「全体整合性レビューでの指摘」参照）。

import type { ConnectionStatus } from "../schemas/connection.js";

/**
 * 目的: コマンド実行結果のstdoutを接続状態(ConnectionStatus)へ変換する。
 * 入力: outputFormat(プロファイルで指定された出力形式、Phase1では"json"のみ), stdout(コマンドの標準出力)。
 * 出力: 接続状態オブジェクト。
 * 失敗時の方針: 未対応のoutputFormat、またはstdoutが期待する形状でない場合は例外を投げる
 *              （呼び出し元でコマンド実行失敗と同様に扱う）。
 */
export function parseConnectionOutput(outputFormat: string, stdout: string): ConnectionStatus {
  if (outputFormat === "json") {
    return parseJsonOutput(stdout);
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
