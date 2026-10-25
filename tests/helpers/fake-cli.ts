// 責務: APIサーバの受け入れテスト用の、VPNベンダーCLIの代役（状態を持つ）。
// 実CLIの出力例（`vendors/<ID>/samples.json`）に沿った書式で、`status` `list-locations` `account` 相当などに応答する。
// ゲートウェイの代役（fake-gateway.ts）の `exec` ハンドラとして使い、受け取った実行要求を記録する。

import type { CliResult } from "./fake-gateway.js";

export interface FakeCliState {
  /** 現在の接続先の表示名（未接続はundefined）。 */
  connected: string | undefined;
  loggedIn: boolean;
  /** "free" は無料プラン、"premium" は有料プランの出力を返す。 */
  plan: "free" | "premium";
  /** trueのとき、接続先を指定した接続がプラン制限の文言で失敗する。 */
  restrictConnect: boolean;
  /** 非ゼロで終わらせるサブコマンド（`disconnect` の失敗の再現用）。 */
  failing: Set<string>;
  /** サブコマンドごとの実行回数。 */
  calls: Record<string, number>;
  /** 受け取った実行要求（ベンダーIDと本文）。 */
  executed: Array<{ vendor: string; body: Record<string, unknown> }>;
}

const ADGUARD_LIST =
  "ISO   COUNTRY              CITY                           PING ESTIMATE\n" +
  "US    United States        Las Vegas                      111       \n" +
  "JP    Japan                Tokyo                          4         \n" +
  "CN    China                Shanghai (Virtual)             59        \n";

const PROTON_LIST = "Code  Country\n----  -------------\nJP    Japan\nUS    United States\n";

/**
 * 目的: CLIの代役と、その状態を作る。
 * 出力: state（テストが書き換えられる状態）と exec（ゲートウェイの代役へ渡す実行ハンドラ）。
 */
export function createFakeCli(): { state: FakeCliState; exec: (vendor: string, body: Record<string, unknown>) => CliResult } {
  const state: FakeCliState = {
    connected: undefined,
    loggedIn: true,
    plan: "free",
    restrictConnect: false,
    failing: new Set(),
    calls: {},
    executed: [],
  };
  const ok = (stdout: string): CliResult => ({ exitCode: 0, stdout, stderr: "" });
  const fail = (stdout: string, stderr = "", exitCode = 1): CliResult => ({ exitCode, stdout, stderr });

  /** 単体バイナリ型（URL提示型のログイン）の代役。 */
  function adguard(argv: string[]): CliResult {
    switch (argv[0]) {
      case "list-locations":
        return ok(ADGUARD_LIST);
      case "license":
        if (!state.loggedIn) return fail("Please log in to view your license info", "", 11);
        return ok(
          `Logged in as user@example.test\nYou are using the ${state.plan === "premium" ? "PREMIUM" : "FREE"} version\n` +
            (state.plan === "free" ? "You have 3.00 GB left for this month\n" : ""),
        );
      case "status":
        return ok(state.connected === undefined ? "VPN is disconnected\n" : `Connected to ${state.connected} in TUN mode, running on tun0\n`);
      case "connect":
        state.connected = (argv[2] ?? "").toUpperCase();
        return ok(`Successfully Connected to ${state.connected}\n`);
      case "disconnect":
        state.connected = undefined;
        return ok("VPN stopped\n");
      case "login":
        return { exitCode: null, stdout: "You need to authorize in your browser. The following link will be available for 1799 seconds: https://auth.adguard.io/device_code?user_code=ABCD-1234\n", stderr: "" };
      case "logout":
        state.loggedIn = false;
        state.connected = undefined;
        return ok("Logged out\n");
      default:
        return fail("", `unknown subcommand ${argv[0]}`);
    }
  }

  /** 常駐サービス依存型（ユーザー名・パスワード入力型のログイン）の代役。 */
  function proton(argv: string[], body: Record<string, unknown>): CliResult {
    switch (argv[0]) {
      case "config":
        if (!state.loggedIn) return fail("Error: Authentication required to view feature status.", "", 2);
        return ok(state.plan === "free" ? "kill-switch: Upgrade to enable\nTo upgrade to VPN Plus visit: https://example.test\n" : "kill-switch: off\n");
      case "countries":
        return ok(PROTON_LIST);
      case "status":
        return ok(state.connected === undefined ? "Disconnected\n" : `Connected to ${state.connected}\n`);
      case "connect":
        if (argv.includes("--country") && state.restrictConnect) return fail("", "Error: this server is not available on the free plan", 1);
        state.connected = argv.includes("--country") ? (argv[2] ?? "").toUpperCase() : "FREE#1";
        return ok(`Server: ${state.connected}\n`);
      case "disconnect":
        state.connected = undefined;
        return ok("Disconnected.\n");
      case "signin": {
        state.loggedIn = true;
        // 入力された秘密情報をそのまま出力へ反映するCLIの代役（応答へ秘密情報が漏れないことの確認用）。
        const stdin = typeof body.stdin === "string" ? body.stdin : "";
        return state.failing.has("signin") ? fail(`bad credentials: ${stdin}`, `rejected input ${stdin}`) : ok("Signed in\n");
      }
      case "signout":
        state.loggedIn = false;
        state.connected = undefined;
        return ok("Signed out\n");
      default:
        return fail("", `unknown subcommand ${argv[0]}`);
    }
  }

  const exec = (vendor: string, body: Record<string, unknown>): CliResult => {
    const argv = (body.resolvedArgv as string[] | undefined) ?? [];
    const key = argv[0] ?? "";
    state.calls[`${vendor}:${key}`] = (state.calls[`${vendor}:${key}`] ?? 0) + 1;
    state.executed.push({ vendor, body });
    if (state.failing.has(key) && key !== "signin") return fail("", `${key} failed`, 1);
    return vendor === "adguardvpn" ? adguard(argv) : proton(argv, body);
  };
  return { state, exec };
}
