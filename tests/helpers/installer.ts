// 責務: インストーラ（`installer/setup.sh`）の受け入れテスト共通のヘルパー。
// 偽のリポジトリ（ベンダーバンドル付き）を一時ディレクトリへ作り、`VPNGW_INSTALL_LIB=1` で関数だけを読み込んで実行する。
// 実際の導入（apt・Docker・ホスト設定・起動）は行わない。

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoPath } from "./repo.js";

export interface FakeRepoOptions {
  /** バンドルを持つベンダーID（profile.json と compose.yml を作る）。 */
  vendors?: string[];
  /** compose.yml を持たない（バンドルとして不完全な）ベンダーID。 */
  incompleteVendors?: string[];
  /** ベンダーIDごとの install-host.sh の内容。 */
  hostHooks?: Record<string, string>;
}

/**
 * 目的: setup.sh と各ベンダーバンドルを持つ偽のリポジトリを一時ディレクトリへ作る。
 * 入力: options（ベンダーバンドルの構成）。
 * 出力: 偽のリポジトリの絶対パス。
 */
export function makeFakeRepo(options: FakeRepoOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), "vpngwgui-accept-installer-"));
  mkdirSync(join(root, "installer"), { recursive: true });
  copyFileSync(repoPath("installer/setup.sh"), join(root, "installer", "setup.sh"));
  for (const id of options.vendors ?? ["vendora", "vendorb"]) {
    mkdirSync(join(root, "vendors", id), { recursive: true });
    writeFileSync(join(root, "vendors", id, "profile.json"), JSON.stringify({ vendor: id }));
    writeFileSync(join(root, "vendors", id, "compose.yml"), "");
  }
  for (const id of options.incompleteVendors ?? []) {
    mkdirSync(join(root, "vendors", id), { recursive: true });
    writeFileSync(join(root, "vendors", id, "profile.json"), JSON.stringify({ vendor: id }));
  }
  for (const [id, script] of Object.entries(options.hostHooks ?? {})) {
    writeFileSync(join(root, "vendors", id, "install-host.sh"), script);
  }
  return root;
}

export interface ShellResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * 目的: 偽のリポジトリの setup.sh を関数として読み込み、指定したシェルスクリプトを実行する。
 * 入力: fakeRepo（makeFakeRepo の戻り値）, script（setup.sh を読み込んだ後に実行するシェルの文）, env（追加の環境変数）。
 * 出力: 終了コード・標準出力・標準エラー。
 * 例: runSetupLib(repo, "setup_web_port; printf '%s' \"$WEB_PORT\"")
 */
export function runSetupLib(fakeRepo: string, script: string, env: Record<string, string> = {}): ShellResult {
  const result = spawnSync("sh", ["-c", `. "${fakeRepo}/installer/setup.sh"; ${script}`], {
    encoding: "utf8",
    env: { ...process.env, VPNGW_INSTALL_LIB: "1", VPNGW_REPO_ROOT: fakeRepo, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
