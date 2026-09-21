// 責務: nftスクリプト文字列を`nft -f -`（標準入力からルールセットを読み込むモード）で実行する。
// `iptables`コマンドは使わない（legacy/nftバックエンドの曖昧さを避けるため、proxyserver/design.md
// 「NAT/FORWARDルール」参照）。ルール文字列の組み立て（ruleset.ts）とは責務を分離する。

import { spawn } from "node:child_process";

const NFT_BIN = process.env.NFT_BIN ?? "nft";
// vpngwguiユーザーは非rootで動作するが、nftテーブル操作はroot権限を要する。実VPNベンダーCLIの
// TUN設定と同様にパスワードなしsudo（proxy/Dockerfile参照）を経由する。
const SUDO_BIN = process.env.SUDO_BIN ?? "sudo";
const DEFAULT_TIMEOUT_MS = 5000;

export interface NftResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * 目的: nftスクリプトを`sudo nft -f -`へ標準入力から渡して実行する。
 * 入力: script(nftコマンド列。改行区切り、ruleset.tsの出力を想定), timeoutMs(省略時5000ms)。
 * 出力: exitCode/stdout/stderrを含むPromise。
 * 失敗時の方針: プロセス起動自体に失敗した場合・timeoutMs超過時はexitCode=-1として返す
 *              （呼び出し元をクラッシュさせない。command-runner.tsのrunCommandと同じ方針）。
 * 例: await runNftScript("add table inet vpngwgui\n")
 */
export function runNftScript(script: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<NftResult> {
  return new Promise((resolve) => {
    // シェルを経由せずspawnするため、script内容がシェルメタ文字を含んでも解釈されない
    // （nft自身の文法として解釈されるのみ）。
    const child = spawn(SUDO_BIN, [NFT_BIN, "-f", "-"], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ exitCode: -1, stdout, stderr });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });

    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr });
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}
