// 責務: LAN クライアント（名前空間 lan）でコマンドを実行する。透過ゲートウェイの通信の確認に使う（要件 5.1・6.1）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** LAN クライアントでの実行結果。 */
export interface LanResult {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * 目的: LAN クライアントの名前空間で、コマンドを実行する。
 * 入力: command（実行するコマンドと引数）。
 * 出力: 標準出力と標準エラー。終了コードが 0 以外なら例外（呼び出し側の試験を失敗にする）。
 */
export async function lanExec(command: readonly string[]): Promise<LanResult> {
  const { stdout, stderr } = await run("sudo", ["ip", "netns", "exec", "lan", ...command], { encoding: "utf8" });
  return { stdout, stderr };
}
