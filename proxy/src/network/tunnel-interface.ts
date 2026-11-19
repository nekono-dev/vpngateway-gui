// 責務: 「公開インターネット宛の通信が現在どのインターフェースから出るか」を`ip route get`で検出する。
// VPN CLIが確立するトンネルインターフェースは名称・経路切替方式とも固定できない。メインテーブルの
// default route を変更しないポリシールーティングにも対応するため、ip ruleを含むカーネルの経路選択を使う。
// 問い合わせ先はDNSサーバ宛て等の個別経路に一致しないよう、予約済みTEST-NET-1から選ぶ。

import { spawn } from "node:child_process";

const IP_BIN = process.env.IP_BIN ?? "ip";

// 経路問い合わせ先。TEST-NET-1は文書用に予約され、実際の通信は行わず経路選択だけを確認する。
const PROBE_ADDRESS = "192.0.2.1";

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
 * 目的: 指定宛先への通信が出ていくインターフェース名を、カーネルの経路選択結果から得る（`ip -4 route get <宛先> [mark <値>]`。
 *      パケットは送らない）。設定の動作検証が、迂回の印（fwmark）を付けた通信の経路を確かめるために使う。
 * 入力: address(宛先のIPv4アドレス), fwmark(省略可。付けた場合の経路を問い合わせる)。
 * 出力: インターフェース名。取得できない場合はundefined。
 * 例: await getRouteInterface("203.0.113.5", 0x100) // => "eth0"
 */
export function getRouteInterface(address: string, fwmark?: number): Promise<string | undefined> {
  const args = ["-4", "route", "get", address, ...(fwmark === undefined ? [] : ["mark", `0x${fwmark.toString(16)}`])];
  return new Promise((resolve) => {
    const child = spawn(IP_BIN, args, { stdio: ["ignore", "pipe", "ignore"] });
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
    const child = spawn(IP_BIN, ["-4", "route", "get", PROBE_ADDRESS], { stdio: ["ignore", "pipe", "ignore"] });
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
