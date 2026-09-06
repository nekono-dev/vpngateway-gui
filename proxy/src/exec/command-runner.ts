// 責務: 許可済みバイナリをシェルを経由せずに実行し、結果を構造化して返す。

import { execFile } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * 目的: `binary`を`argv`で実行し、結果を待ち受ける。
 * 入力: binary(絶対パス、呼び出し元で許可リスト照合済みであること), argv(コマンド引数配列), timeoutMs(タイムアウトms)。
 * 出力: exitCode/stdout/stderrを含むPromise。timeoutMs超過時はexitCode=-1として返す（呼び出し元プロセスをクラッシュさせない）。
 * 例: runCommand("/usr/local/bin/adguardvpn-cli-mock", ["connection", "-s"], 5000)
 */
export function runCommand(
  binary: string,
  argv: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    // execFileはシェルを経由しないため、argv内にシェルメタ文字が含まれても解釈されない。
    execFile(binary, argv, { timeout: timeoutMs }, (error, stdout, stderr) => {
      const exitCode = error && typeof error.code === "number" ? error.code : error ? -1 : 0;
      resolve({ exitCode, stdout, stderr });
    });
  });
}
