// 責務: 導入の手順（install.sh の生成と実行）を、試験から呼ぶ。本番と同じ経路（build-bootstrap の出力）を使う（要件 9.x）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** 作業場所（provision.sh の E2E_WORK_DIR と一致させる）。 */
export const WORK_DIR = "e2e/hosted/.work";
/** 生成した install.sh の場所。 */
export const INSTALLER = `${WORK_DIR}/install.sh`;

/** シェルの実行結果。 */
export interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * 目的: 導入の手順（lib の関数）を、シェルで実行する。
 * 入力: script（env.sh・topology.sh・provision.sh を読んだ後に実行する命令）。
 * 出力: 標準出力と標準エラー。終了コードが 0 以外なら例外。
 */
export async function shell(script: string, env: NodeJS.ProcessEnv = {}): Promise<ShellResult> {
  const full = `set -eu; . e2e/hosted/lib/env.sh; . e2e/hosted/lib/topology.sh; . e2e/hosted/lib/provision.sh; ${script}`;
  const { stdout, stderr } = await run("bash", ["-c", full], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...env } });
  return { stdout, stderr };
}

/**
 * 目的: 生成済みの install.sh を、管理者権限で実行する（status・update・uninstall）。
 * 入力: args（install.sh の引数）。
 * 出力: 標準出力と標準エラー。終了コードが 0 以外なら例外。
 */
export async function installer(args: readonly string[]): Promise<ShellResult> {
  const { stdout, stderr } = await run("sudo", ["sh", INSTALLER, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { stdout, stderr };
}

/**
 * 目的: 導入済みの制御コマンド（vpngwgui-ctl）を管理者権限で実行する（status・update・refs）。
 * install.sh（bootstrap）は install・uninstall だけを持つため、status と update はこちらを使う。
 * 入力: args（制御コマンドの引数）。
 * 出力: 標準出力と標準エラー。終了コードが 0 以外なら例外。
 */
export async function control(args: readonly string[]): Promise<ShellResult> {
  const { stdout, stderr } = await run("sudo", ["vpngwgui-ctl", ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { stdout, stderr };
}

/** 管理者権限で、パスが存在するかを確かめる（存在すれば true）。 */
export async function exists(path: string): Promise<boolean> {
  try {
    await run("sudo", ["test", "-e", path]);
    return true;
  } catch {
    return false;
  }
}
