// 責務: 両ベンダーの CLI の代替（モック）。呼び出し名でベンダーを決め、プロファイルの argv と samples.json の出力に従う（要件 3.1〜3.7・4.1）。
// 出力は samples.json の該当ケースの stdout をそのまま使う（出力の契約をずらさないため）。
// ネットワークの変更（vpn0 の作成・既定経路の移動）は Network の実装に任せ、単体テストでは差し替える。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type VendorId = "protonvpn" | "adguardvpn";

/** 状態（ファイル。ログイン状態・プラン・接続先）。 */
export interface MockState {
  loggedIn: boolean;
  plan: "free" | "paid" | "premium" | "unknown";
  connected: boolean;
  location?: string;
}

/** 経路の操作（vpn0 と既定経路）。実装は hosted の netns 内、テストでは記録だけを行う。 */
export interface Network {
  connect(): void;
  disconnect(): void;
}

/** CLI の実行結果。 */
export interface MockResult {
  readonly exitCode: number;
  readonly stdout: string;
}

/** 呼び出し名からベンダーを決める（protonvpn・adguardvpn-cli のどちらか）。 */
export function vendorFromBinary(binary: string): VendorId {
  const base = binary.split("/").pop() ?? binary;
  if (base === "protonvpn") return "protonvpn";
  if (base === "adguardvpn-cli") return "adguardvpn";
  throw new Error(`モックが知らない呼び出し名: ${base}`);
}

/** samples.json の 1 件（本ツールが読む部分）。 */
interface SampleCase {
  readonly name: string;
  readonly kind: string;
  readonly stdout?: string;
  readonly output?: string;
  readonly exitCode: string;
}

/**
 * 目的: samples.json の、指定の名前の出力を取り出す（出力の契約として使う）。
 * 入力: vendor、name（ケースの名前の完全一致）。
 * 出力: stdout（または output）の文字列。
 * 失敗時の方針: ケースが無ければ例外（契約からずれた出力を返さない）。
 */
export function sampleOutput(vendor: VendorId, name: string): string {
  const samples = JSON.parse(readFileSync(new URL(`../../../../vendors/${vendor}/samples.json`, import.meta.url), "utf8")) as {
    cases: SampleCase[];
  };
  const found = samples.cases.find((c) => c.name === name);
  if (found === undefined) throw new Error(`samples.json にケースが無い: ${name}`);
  return found.stdout ?? found.output ?? "";
}

/**
 * 目的: 1 回の CLI 呼び出しを処理する。
 * 入力: vendor、argv（呼び出しの引数。先頭はコマンド）、state（現在の状態。変更される）、network（経路の操作）、stdin（パスワードと 2FA の行）。
 * 出力: 終了コードと標準出力。state は更新される。
 * 失敗時の方針: 未対応のコマンドは終了コード 2 とする（黙って成功させない）。
 */
export function runCommand(vendor: VendorId, argv: readonly string[], state: MockState, network: Network, stdin: readonly string[] = []): MockResult {
  const [command, ...rest] = argv;
  if (vendor === "protonvpn") return runProton(command, rest, state, network, stdin);
  return runAdGuard(command, rest, state, network);
}

function runProton(command: string | undefined, rest: readonly string[], state: MockState, network: Network, stdin: readonly string[]): MockResult {
  switch (command) {
    case "signin": {
      const password = stdin[0] ?? "";
      if (password === "") return { exitCode: 1, stdout: "Error: Password is required\n" };
      state.loggedIn = true;
      state.plan = "free";
      return { exitCode: 0, stdout: "Login successful.\n" };
    }
    case "signout":
      state.loggedIn = false;
      state.connected = false;
      state.location = undefined;
      return { exitCode: 0, stdout: "Logged out.\n" };
    case "connect": {
      if (!state.loggedIn) return { exitCode: 1, stdout: "Error: Authentication required\n" };
      const country = rest[0] === "--country" ? rest[1] : undefined;
      state.connected = true;
      state.location = country === undefined ? "JP-FREE#3 in Osaka, Japan" : `${country.toUpperCase()}-FREE#1 in Tokyo, Japan`;
      network.connect();
      return { exitCode: 0, stdout: `Connected to ${state.location}.\nYour new IP address is 203.0.113.9.\n` };
    }
    case "disconnect":
      if (state.connected) network.disconnect();
      state.connected = false;
      state.location = undefined;
      return { exitCode: 0, stdout: "Disconnected.\n" };
    case "status":
      return { exitCode: 0, stdout: state.connected ? sampleOutput("protonvpn", "status: 接続中") : sampleOutput("protonvpn", "status: 切断中（未ログインでも同じ）") };
    case "countries":
      return { exitCode: 0, stdout: "Country          Code\n---------------  ------\nJapan            JP\nUnited States    US\n" };
    case "config":
      if (!state.loggedIn) return { exitCode: 2, stdout: sampleOutput("protonvpn", "account: 未ログイン（非ゼロ終了でも未ログインと判定）") };
      return { exitCode: 0, stdout: sampleOutput("protonvpn", state.plan === "paid" ? "account: 有料版（無料版の文言が無い）" : "account: 無料版") };
    default:
      return { exitCode: 2, stdout: `Error: unknown command ${command ?? ""} ${rest.join(" ")}\n` };
  }
}

function runAdGuard(command: string | undefined, rest: readonly string[], state: MockState, network: Network): MockResult {
  switch (command) {
    case "login":
      // device 認証の案内（完了パターンに一致する URL を出す）。試験では承認済みとして扱う
      state.loggedIn = true;
      state.plan = "premium";
      return { exitCode: 0, stdout: "Open https://auth.adguard.io/device_code?user_code=ABCD-1234 to log in\n" };
    case "logout":
      state.loggedIn = false;
      state.connected = false;
      state.location = undefined;
      return { exitCode: 0, stdout: "Logged out\n" };
    case "connect": {
      if (!state.loggedIn) return { exitCode: 1, stdout: "Please log in\n" };
      const idx = rest.indexOf("-l");
      const city = idx === -1 ? "TOKYO" : (rest[idx + 1] ?? "TOKYO").toUpperCase();
      state.connected = true;
      state.location = city;
      network.connect();
      return { exitCode: 0, stdout: `Connected to ${city} in TUN mode, running on tun0\n` };
    }
    case "disconnect":
      if (state.connected) network.disconnect();
      state.connected = false;
      state.location = undefined;
      return { exitCode: 0, stdout: "VPN is disconnected\n" };
    case "status":
      if (!state.loggedIn) return { exitCode: 0, stdout: "You are not logged in\n" };
      return state.connected
        ? { exitCode: 0, stdout: `Connected to ${state.location ?? "TOKYO"} in TUN mode, running on tun0\n` }
        : { exitCode: 0, stdout: "VPN is disconnected\n" };
    case "list-locations":
      return { exitCode: 0, stdout: sampleOutput("adguardvpn", "listLocations: 表・ping昇順・注記付きの都市の指定名") };
    case "license":
      if (!state.loggedIn) return { exitCode: 11, stdout: sampleOutput("adguardvpn", "account: 未ログイン") };
      return { exitCode: 0, stdout: sampleOutput("adguardvpn", state.plan === "free" ? "account: 無料版（残りデータ通信量の補足情報）" : "account: 有料版") };
    default:
      return { exitCode: 2, stdout: `Error: unknown command ${command ?? ""} ${rest.join(" ")}\n` };
  }
}

/** 状態の初期値（未ログイン・未接続）。 */
export const INITIAL_STATE: MockState = { loggedIn: false, plan: "unknown", connected: false };

/**
 * 目的: 状態ファイルを読む（無ければ初期値）。
 */
export function readState(path: string): MockState {
  if (!existsSync(path)) return { ...INITIAL_STATE };
  return JSON.parse(readFileSync(path, "utf8")) as MockState;
}

/**
 * 目的: 状態ファイルへ書く（親ディレクトリが無ければ作る）。
 */
export function writeState(path: string, state: MockState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state)}\n`, "utf8");
}
