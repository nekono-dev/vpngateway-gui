// 責務: 受け入れテスト共通の、リポジトリ内ファイルの参照ヘルパー。
// リポジトリの直下を基準に、ファイルの読み取り・存在確認・ディレクトリ一覧を提供する。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** リポジトリ直下の絶対パス。 */
export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * 目的: リポジトリ直下からの相対パスを絶対パスへ変換する。
 * 入力: 相対パス（例: "vendors/adguardvpn/compose.yml"）。
 * 出力: 絶対パス。
 */
export function repoPath(relativePath: string): string {
  return join(repoRoot, relativePath);
}

/**
 * 目的: リポジトリ内のテキストファイルを読む。
 * 入力: リポジトリ直下からの相対パス。
 * 出力: UTF-8の文字列。存在しなければ例外（テストを失敗させる）。
 */
export function readRepoFile(relativePath: string): string {
  return readFileSync(repoPath(relativePath), "utf8");
}

/** 目的: リポジトリ内のファイルまたはディレクトリが存在するか返す。 */
export function repoFileExists(relativePath: string): boolean {
  return existsSync(repoPath(relativePath));
}

/**
 * 目的: ベンダーバンドル（`vendors/<ID>/`）のID一覧を返す。
 * 出力: ディレクトリ名の昇順の配列。
 */
export function listVendorIds(): string[] {
  return readdirSync(repoPath("vendors"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
