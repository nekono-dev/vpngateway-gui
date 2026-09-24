// 責務: ドメイン迂回のポリシールーティング（`ip rule`・ルーティングテーブル100）を管理する。fwmarkが付いた通信を、
// VPNトンネルではなく実回線（LAN側インターフェースのデフォルトゲートウェイ）へ向ける
// （proxyserver/design.md「ドメイン迂回とDNS中継」の「nft set・ポリシールーティング」）。

import { spawn } from "node:child_process";
import { isValidInterfaceName } from "../lib/interface-name.js";
import { BYPASS_FWMARK, BYPASS_ROUTE_TABLE } from "./ruleset.js";

const IP_BIN = process.env.IP_BIN ?? "ip";
const SUDO_BIN = process.env.SUDO_BIN ?? "sudo";
// VPNベンダーCLIが追加するポリシールールより優先されるよう、小さい値（高い優先度）にする。
export const BYPASS_RULE_PRIORITY = 100;

export interface IpCommandResult {
  exitCode: number;
  stdout: string;
}

// `ip`コマンドの実行（テストで差し替える境界）。changesRouting=trueの場合はsudoを付ける。
export type IpRunner = (args: readonly string[], changesRouting: boolean) => Promise<IpCommandResult>;

function runIpCommand(args: readonly string[], changesRouting: boolean): Promise<IpCommandResult> {
  return new Promise((resolve) => {
    const [command, commandArgs] = changesRouting ? [SUDO_BIN, [IP_BIN, ...args]] : [IP_BIN, [...args]];
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolve({ exitCode: -1, stdout }));
    child.on("exit", (code) => resolve({ exitCode: code ?? -1, stdout }));
  });
}

/**
 * 目的: `ip -4 route show default dev <IF>`の出力から、デフォルトゲートウェイのアドレスを取り出す。
 * 入力: output(標準出力)。
 * 出力: `default via 192.168.3.1 ...`のゲートウェイ。`via`が無い（ポイントツーポイント等）・出力なしはundefined。
 */
export function parseDefaultGateway(output: string): string | undefined {
  const match = /^default via (\d{1,3}(?:\.\d{1,3}){3})\b/m.exec(output);
  return match?.[1];
}

/** `ip -4 rule show`の出力に、迂回用のルールがあるかを判定する。 */
export function hasBypassRule(output: string): boolean {
  return output.split("\n").some((line) => line.includes(`fwmark 0x${BYPASS_FWMARK.toString(16)}`) && line.includes(`lookup ${BYPASS_ROUTE_TABLE}`));
}

export class PolicyRouting {
  // 直近に検出できたゲートウェイ。VPN接続中にメインテーブルのデフォルトルートが書き換えられて検出できない場合の代替。
  private lastGateway: string | undefined;
  private installed = false;

  /**
   * 入力: lanIface(LAN側インターフェース名), runIp(ipコマンドの実行。テスト用フック)。
   */
  constructor(
    private readonly lanIface: string | undefined,
    private readonly runIp: IpRunner = runIpCommand,
  ) {}

  /**
   * 目的: 迂回が必要かどうかに合わせて、ルールと経路を整える（冪等。接続監視のたびにも呼べる）。
   * 入力: active(ドメイン迂回が有効か)。
   * 出力: 整えられた（または不要で撤去した）場合はtrue。ゲートウェイを特定できない等で整えられなかった場合はfalse。
   */
  async sync(active: boolean): Promise<boolean> {
    if (this.lanIface === undefined || !isValidInterfaceName(this.lanIface)) return !active;
    if (!active) {
      if (this.installed) await this.remove();
      return true;
    }
    const detected = parseDefaultGateway((await this.runIp(["-4", "route", "show", "default", "dev", this.lanIface], false)).stdout);
    const gateway = detected ?? this.lastGateway;
    if (gateway === undefined) return false;
    this.lastGateway = gateway;

    const route = await this.runIp(["-4", "route", "show", "table", String(BYPASS_ROUTE_TABLE)], false);
    if (!route.stdout.includes(`default via ${gateway}`)) {
      const replaced = await this.runIp(
        ["-4", "route", "replace", "default", "via", gateway, "dev", this.lanIface, "table", String(BYPASS_ROUTE_TABLE)],
        true,
      );
      if (replaced.exitCode !== 0) return false;
    }
    const rules = await this.runIp(["-4", "rule", "show"], false);
    if (!hasBypassRule(rules.stdout)) {
      const added = await this.runIp(
        ["-4", "rule", "add", "fwmark", `0x${BYPASS_FWMARK.toString(16)}`, "table", String(BYPASS_ROUTE_TABLE), "priority", String(BYPASS_RULE_PRIORITY)],
        true,
      );
      if (added.exitCode !== 0) return false;
    }
    this.installed = true;
    return true;
  }

  private async remove(): Promise<void> {
    // 存在しない場合は失敗するが、撤去が目的のため無視する。
    await this.runIp(["-4", "rule", "del", "fwmark", `0x${BYPASS_FWMARK.toString(16)}`, "table", String(BYPASS_ROUTE_TABLE)], true);
    await this.runIp(["-4", "route", "flush", "table", String(BYPASS_ROUTE_TABLE)], true);
    this.installed = false;
  }
}
