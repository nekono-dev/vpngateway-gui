// 責務: モック CLI の接続・切断に伴う経路の操作（ホストの既定経路を vpn0 へ移し、切断で元に戻す）。要件 3.1・3.2 の模擬。
// 退避した既定経路は状態ファイルに保存し、切断で戻す。接続・切断は何度呼んでも同じ結果になる（冪等）。

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** コマンドの実行の差し替え点（テストでは記録だけを行う）。 */
export type RunIp = (args: readonly string[]) => string;

/**
 * 既定の実行: ip を呼ぶ。root でなければ sudo（パスワード無し）で呼ぶ。hosted runner と、そのコンテナの中でだけ使う。
 * コンテナの中のモックは sudoers で ip だけを許可する（vendors の mock Dockerfile）。
 */
export const runIpWithSudo: RunIp = (args) =>
  process.getuid?.() === 0
    ? execFileSync("ip", [...args], { encoding: "utf8" })
    : execFileSync("sudo", ["-n", "ip", ...args], { encoding: "utf8" });

/** トンネルの出口（vpnexit 側）のアドレス。topology.sh の E2E_TUN_EXIT と一致させる。 */
export const TUNNEL_EXIT_ADDRESS = "10.66.0.2";
export const TUNNEL_DEVICE = "vpn0";

/**
 * 目的: 接続・切断の経路操作を行う Network を作る。
 * 入力: stateFile(退避した既定経路を保存する場所)、runIp(ip コマンドの実行。既定は sudo ip)。
 * 出力: connect（既定経路を vpn0 へ移す）と disconnect（退避した既定経路へ戻す）。
 * 失敗時の方針: ip が失敗すれば例外をそのまま投げる（経路が変わったまま成功扱いにしない）。
 */
export function createNetwork(stateFile: string, runIp: RunIp = runIpWithSudo) {
  const readSaved = (): string | undefined => (existsSync(stateFile) ? readFileSync(stateFile, "utf8").trim() : undefined);

  return {
    connect(): void {
      if (readSaved() !== undefined) return; // 既に接続中（退避済み）なら何もしない
      const current = runIp(["-4", "route", "show", "default"]).split("\n")[0] ?? "";
      const saved = current.replace(/^default\s+/, "").trim();
      mkdirSync(dirname(stateFile), { recursive: true });
      writeFileSync(stateFile, `${saved}\n`, "utf8");
      runIp(["-4", "route", "replace", "default", "via", TUNNEL_EXIT_ADDRESS, "dev", TUNNEL_DEVICE]);
    },
    disconnect(): void {
      const saved = readSaved();
      if (saved === undefined) return; // 接続していなければ何もしない
      runIp(["-4", "route", "replace", "default", ...saved.split(/\s+/)]);
      rmSync(stateFile, { force: true });
    },
  };
}
