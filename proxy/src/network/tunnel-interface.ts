// 責務: 「公開インターネット宛の通信が現在どのインターフェースから出るか」を`ip route get`で検出する。
// VPNベンダーCLIが確立するトンネルインターフェース（tun0等）はベンダー・バージョン依存で名称が
// 固定できず、かつ経路の切替方式もベンダー依存である。CLIによっては、メインテーブルのデフォルトルートを
// 書き換えず、ポリシールーティング（`ip rule`で専用テーブルを優先参照）で全通信をトンネルへ向けるため、
// `ip route show default`（メインテーブルのみ参照）では接続を検知できない。`ip route get <公開IP>`は
// ポリシールーティングを含めたカーネルの実際の経路選択結果を返すため、どちらの方式のベンダーにも対応できる
// （proxyserver/design.md「透過ゲートウェイモードの実現方式」参照）。

import { spawn } from "node:child_process";

const IP_BIN = process.env.IP_BIN ?? "ip";

// 経路問い合わせに使う公開IPアドレス（実際にはパケットを送らない。カーネルの経路選択結果のみを得る）。
// VPNが常に経路を奪う対象（インターネット上の一般的なアドレス）であればよい。
const PROBE_ADDRESS = "1.1.1.1";

/**
 * 目的: `ip route get <宛先>`の標準出力から、経路が出力されるインターフェース名を抽出する。
 *      ネットワークI/Oを伴わない純粋関数。
 * 入力: output(`ip route get`の標準出力文字列。先頭行に経路、2行目以降にキャッシュ情報等が続きうる)。
 * 出力: 先頭の非空行の`dev <IF名>`部分。`dev`トークンが見当たらない場合はundefined。
 * 期待する入力形状: 先頭行が`<宛先> [via <GW>] dev <IF名> [table N] src <IP> ...`形式（iproute2の標準出力形式）。
 * 例: parseRouteGetInterface("1.1.1.1 dev tun0 table 880 src 172.16.219.2 uid 0\n    cache\n")
 *     // => "tun0"
 */
export function parseRouteGetInterface(output: string): string | undefined {
  const firstLine = output.split("\n").find((line) => line.trim().length > 0);
  if (!firstLine) return undefined;

  const tokens = firstLine.trim().split(/\s+/);
  const devIndex = tokens.indexOf("dev");
  if (devIndex === -1 || devIndex + 1 >= tokens.length) return undefined;
  return tokens[devIndex + 1];
}

/**
 * 目的: 公開インターネット宛の通信が現在出ていくインターフェース名を取得する（`ip route get`を実行）。
 * 入力: なし。
 * 出力: インターフェース名。取得できない場合（コマンド失敗・経路無し等）はundefined。
 * 失敗時の方針: `ip`コマンド自体が失敗した場合も例外を投げずundefinedを返す
 *              （呼び出し元はKill Switch判定のため「VPN未接続」として扱えば十分なため）。
 * 例: await getEgressInterface() // => "tun0" | "eth0" | undefined
 */
export function getEgressInterface(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(IP_BIN, ["route", "get", PROBE_ADDRESS], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolve(undefined));
    child.on("exit", (code) => {
      resolve(code === 0 ? parseRouteGetInterface(stdout) : undefined);
    });
  });
}
