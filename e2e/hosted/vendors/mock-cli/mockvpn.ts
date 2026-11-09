// 責務: 両ベンダーの CLI の代替（モック）。呼び出し名でベンダーを決め、プロファイルの argv と samples.json の出力に従う（要件 3.1〜3.7・4.1）。
// 出力は samples.json の該当ケースの stdout をそのまま使う（出力の契約をずらさないため）。
// ネットワークの変更（vpn0 の作成・既定経路の移動）は Network の実装に任せ、単体テストでは差し替える。

import { renameSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// ProtonVPN の都市一覧・サーバカタログ（実 CLI の形式を模擬。api の解析規則 parseCityList と読み方 readCatalog で検査する）。
const PROTON_COUNTRIES: Record<string, string> = { JP: "Japan", US: "United States" };
/** 国コード → 都市（都市名と、その都市の Features 欄）。 */
const PROTON_CITIES: Record<string, { city: string; features: string }[]> = {
  JP: [{ city: "Tokyo", features: "" }, { city: "Osaka", features: "P2P" }],
  US: [{ city: "New York", features: "" }],
};
/** サーバカタログ（LogicalServers）。Tier 0 は無料、Features の 1 は Secure Core。 */
export const PROTON_CATALOG = {
  LogicalServers: [
    { Name: "JP-TK#1", ExitCountry: "JP", City: "Tokyo", Tier: 2, Features: 0, Status: true, Score: 1.5, Load: 20 },
    { Name: "JP-TK#2", ExitCountry: "JP", City: "Tokyo", Tier: 2, Features: 4, Status: true, Score: 2.0, Load: 25 },
    { Name: "JP-TK#3", ExitCountry: "JP", City: "Tokyo", Tier: 2, Features: 1, Status: true, Score: 0.5, Load: 10 },
    { Name: "JP-OS#1", ExitCountry: "JP", City: "Osaka", Tier: 2, Features: 0, Status: true, Score: 3.0, Load: 30 },
    { Name: "JP-FREE#5", ExitCountry: "JP", City: "Tokyo", Tier: 0, Features: 0, Status: true, Score: 4.0, Load: 40 },
    { Name: "US-NY#1", ExitCountry: "US", City: "New York", Tier: 2, Features: 0, Status: true, Score: 2.5, Load: 35 },
  ],
};

/**
 * 目的: 都市の一覧の出力（実 CLI の形式: 空行・「Cities in <国名>:」・見出し・区切り・都市の行・空行）を作る。
 * 入力: 国コード（大文字 2 文字）。未知なら undefined。
 */
export function protonCitiesOutput(code: string): string | undefined {
  const cities = PROTON_CITIES[code];
  const name = PROTON_COUNTRIES[code];
  if (cities === undefined || name === undefined) return undefined;
  const width = Math.max("City".length, ...cities.map((c) => c.city.length));
  const rows = cities.map((c) => (c.features === "" ? c.city : `${c.city.padEnd(width)}  ${c.features}`));
  return `\nCities in ${name}:\nCity${" ".repeat(width - 4)}  Features\n${"-".repeat(width)}  --------\n${rows.join("\n")}\n\n`;
}

/**
 * 目的: サーバカタログを、指定のディレクトリの VPN/serverlist.json へ書く（サインイン時）。実 CLI が作るキャッシュの位置を模擬する。
 * 入力: cacheDir（キャッシュの根。既定は MOCKVPN_CACHE_DIR、無ければ /home/vpngwgui/.cache/Proton）。
 * 失敗時の方針: 書けなければ例外（呼び出し側がサインインの失敗として扱う）。
 */
export function writeProtonCatalog(cacheDir: string = process.env.MOCKVPN_CACHE_DIR ?? "/home/vpngwgui/.cache/Proton"): void {
  const file = join(cacheDir, "VPN", "serverlist.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(PROTON_CATALOG, null, 2)}\n`, "utf8");
}

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

/**
 * 試験からの制御（障害の注入）。disconnectFails は切断を失敗させ、responseDelayMs は応答を遅らせる（要件 4.9・4.8 の模擬）。
 * 状態ファイルの control の項目として保存し、試験が書き換える。
 */
export interface MockControl {
  readonly disconnectFails?: boolean;
  readonly responseDelayMs?: number;
  // ログインを失敗させる（資格情報の誤り。要件 3.7 の模擬）
  readonly loginFails?: boolean;
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
  // コンテナの中では MOCKVPN_SAMPLES_DIR（vendors/ を置いた場所）を使う。開発・テストではリポジトリの vendors/ を読む
  const root = process.env.MOCKVPN_SAMPLES_DIR ?? new URL("../../../../vendors", import.meta.url).pathname;
  const samples = JSON.parse(readFileSync(join(root, vendor, "samples.json"), "utf8")) as {
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
export function runCommand(
  vendor: VendorId,
  argv: readonly string[],
  state: MockState,
  network: Network,
  stdin: readonly string[] = [],
  control: MockControl = {},
): MockResult {
  const [command, ...rest] = argv;
  // 切断の失敗の注入: 状態は変えず、経路も戻さない（試験は残った接続を検出する）
  if (command === "disconnect" && control.disconnectFails === true) {
    return { exitCode: 1, stdout: DISCONNECT_FAILURE_OUTPUT };
  }
  if ((command === "signin" || command === "login") && control.loginFails === true) {
    return { exitCode: 1, stdout: "Error: Invalid credentials\n" };
  }
  if (vendor === "protonvpn") return runProton(command, rest, state, network, stdin);
  return runAdGuard(command, rest, state, network);
}

/** モックが受け付ける認証情報（試験の値。fixtures/gateway.ts の MOCK_USER・MOCK_PASSWORD・MOCK_TOTP と一致させる）。 */
export const MOCK_ACCOUNT = { user: "mock-user@example.test", password: "mock-password", totp: "123456" } as const;

function runProton(command: string | undefined, rest: readonly string[], state: MockState, network: Network, stdin: readonly string[]): MockResult {
  switch (command) {
    case "signin": {
      const password = stdin[0] ?? "";
      if (password === "") return { exitCode: 1, stdout: "Error: Password is required\n" };
      // 認証情報は、試験が使う値のみを受け付ける（実アカウントは使わない。誤りは失敗にする）
      const user = rest[rest.length - 1] ?? "";
      if (user !== MOCK_ACCOUNT.user || password !== MOCK_ACCOUNT.password || stdin[1] !== MOCK_ACCOUNT.totp) {
        return { exitCode: 1, stdout: "Error: Invalid credentials\n" };
      }
      state.loggedIn = true;
      state.plan = "paid";
      writeProtonCatalog();
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
      const target = rest[0];
      if (country === undefined && target !== undefined && target !== "--country") {
        // サーバ名（カタログの Name）での接続。国コードの位置引数は国の接続として扱う（実 CLI と同じ）。
        const server = PROTON_CATALOG.LogicalServers.find((item) => item.Name === target);
        if (server === undefined && !/^[A-Za-z]{2}$/.test(target)) return { exitCode: 2, stdout: `Error: Invalid server name '${target}'.\n` };
        if (server !== undefined) {
          state.connected = true;
          state.location = `${server.Name} in ${server.City}, ${PROTON_COUNTRIES[server.ExitCountry] ?? server.ExitCountry}`;
          network.connect();
          return { exitCode: 0, stdout: `Connected to ${state.location}.\nYour new IP address is 203.0.113.9.\n` };
        }
      }
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
    case "cities": {
      // cities list --country <CC>（都市の一覧）。ログインを要しない（実 CLI と同じ）。
      const idx = rest.indexOf("--country");
      const code = idx === -1 ? undefined : rest[idx + 1]?.toUpperCase();
      const output = code === undefined ? undefined : protonCitiesOutput(code);
      if (output === undefined) return { exitCode: 1, stdout: "Error: Invalid country code\n" };
      return { exitCode: 0, stdout: output };
    }
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

/** 切断の失敗の出力（終了コード 1）。 */
export const DISCONNECT_FAILURE_OUTPUT = "Error: failed to disconnect\n";

/**
 * 目的: 状態ファイルを読む（無ければ初期値）。
 */
export function readState(path: string): MockState {
  if (!existsSync(path)) return { ...INITIAL_STATE };
  return JSON.parse(readFileSync(path, "utf8")) as MockState;
}

/**
 * 目的: 制御ファイル（障害の注入）を読む（無ければ空）。
 */
export function readControl(path: string): MockControl {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as MockControl;
}

/**
 * 目的: 状態ファイルへ書く（親ディレクトリが無ければ作る）。
 */
export function writeState(path: string, state: MockState): void {
  mkdirSync(dirname(path), { recursive: true });
  // 一時ファイルへ書いてから差し替える（読む側が書きかけの内容を見ないように）
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state)}\n`, "utf8");
  renameSync(temp, path);
}
