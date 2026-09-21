// 責務: `network_mode: host`のプロキシコンテナ起動時、ホストのIPフォワーディング設定
// （`/proc/sys/net/ipv4/ip_forward`）を確認し、無効であれば有効化するフォールバック処理。
// インストールスクリプトが`/etc/sysctl.d/99-vpngwgui.conf`で永続化するのが本来の経路だが、
// インストールスクリプト未実行環境（＝コンテナ再作成のみでホスト側手順を踏んでいない環境）向けの
// 保険として、コンテナ起動のたびにも確認する（proxyserver/design.md「IPフォワーディングの永続化」参照）。
// ただしDockerはコンテナの/proc/sysを読み取り専用でマウントするため、書き込みは実際には失敗しうる
// （実機検証で確認）。その場合は呼び出し元がisIpForwardEnabled()で検知して警告する。

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const IP_FORWARD_PATH = process.env.IP_FORWARD_PATH ?? "/proc/sys/net/ipv4/ip_forward";
const SUDO_BIN = process.env.SUDO_BIN ?? "sudo";

/**
 * 目的: `/proc/sys/net/ipv4/ip_forward`が現在有効（"1"）かを読み取る。
 * 入力: なし。
 * 出力: 有効なら true。無効、または読み取り不能なら false。
 * 例: if (!isIpForwardEnabled()) { ...警告... }
 */
export function isIpForwardEnabled(): boolean {
  try {
    return readFileSync(IP_FORWARD_PATH, "utf8").trim() === "1";
  } catch {
    return false;
  }
}

/**
 * 目的: `/proc/sys/net/ipv4/ip_forward`が無効（"0"）であれば有効化（"1"）する。
 * 入力: なし。
 * 出力: 有効化のために書き込みを行った場合は true、既に有効だった場合は false を解決するPromise。
 * 副作用: 無効だった場合、`sudo tee`経由で`/proc/sys/net/ipv4/ip_forward`へ"1"を書き込む
 *        （`network_mode: host`のためホストのカーネル設定を直接変更する操作と等価）。
 * 失敗時の方針: 読み取り・書き込みいずれかに失敗した場合も例外を投げず、書き込み未実施として扱う
 *              （呼び出し元の起動シーケンスを止めないため。監査ログへの記録は呼び出し元の責務とする）。
 */
export async function ensureIpForwardEnabled(): Promise<boolean> {
  let current: string;
  try {
    current = readFileSync(IP_FORWARD_PATH, "utf8").trim();
  } catch {
    return false;
  }

  if (current === "1") return false;

  return new Promise((resolve) => {
    // procfsのnet.*エントリはroot所有・0644のため、非rootユーザーからの書き込みにはsudoが必要
    // （proxy/Dockerfile.adguardvpnのパスワードなしsudo設定を利用する。nft-client.tsと同様の方針）。
    const child = spawn(SUDO_BIN, ["tee", IP_FORWARD_PATH], { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
    child.stdin.write("1\n");
    child.stdin.end();
  });
}
