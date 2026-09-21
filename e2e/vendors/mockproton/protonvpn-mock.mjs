#!/usr/bin/env node
// 責務: Proton VPN公式CLI（proton-vpn-cli 1.0.3）の挙動を模擬するモックCLI。Phase 9のE2E（プロバイダ抽象化基盤の検証）専用。
// 実CLIのソース（github.com/ProtonVPN/proton-vpn-cli）で確認した出力文言・終了コード・無料版の制限を再現する:
//   - 未ログイン: connect/config list/countries list は「Authentication required...」で終了コード2（statusは未ログインでも
//     "Status: Disconnected"・終了コード0）
//   - 無料版: connectの引数指定（--country/--city/サーバID/機能/--random）は「... is not available on the free plan」で終了コード2、
//     引数なしのconnectのみ最速の無料サーバへ接続。config listは有料機能が「Upgrade to enable」＋末尾に「To upgrade to VPN Plus」
//   - signin: パスワード（と2FAが必要なときのみ2FAトークン）を標準入力から1行ずつ読む（TTY無しのgetpass相当）
// 状態は MOCK_STATE_FILE（既定 /tmp/protonvpn-mock-state.json）に保存し、コマンドをまたいで保持する。
// 用意済みのアカウント（パスワードは全て mock-pass）:
//   free@example.com（無料）/ paid@example.com（有料）/ free2fa@example.com（無料・2FAコード 123456 が必要）
// 検証用の隠しコマンド: `mock-set-probe-plan <free|paid>` は、`config list`が表示するプラン（判定用の出力）だけを実際のプランと
//   食い違わせる（プランの判定では制限が見えないが、実行すると制限に当たる状況＝「実行失敗からの学習」の検証用）。
// 使い方: protonvpn-mock signin free@example.com ／ protonvpn-mock connect ／ protonvpn-mock config list

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const STATE_FILE = process.env.MOCK_STATE_FILE ?? "/tmp/protonvpn-mock-state.json";
const PASSWORD = "mock-pass";
const TWO_FACTOR_CODE = "123456";
const ACCOUNTS = {
  "free@example.com": { plan: "free", twoFactor: false },
  "paid@example.com": { plan: "paid", twoFactor: false },
  "free2fa@example.com": { plan: "free", twoFactor: true },
};
const COUNTRIES = [
  ["Australia", "AU", "Sydney"],
  ["Japan", "JP", "Tokyo"],
  ["Switzerland", "CH", "Zurich"],
  ["United States", "US", "New York"],
];
const FREE_SERVER = "JP-FREE#5 in Tokyo, Japan";

/** 状態ファイルを読む。無い・壊れている場合は初期状態（未ログイン・未接続）。 */
function loadState() {
  if (!existsSync(STATE_FILE)) return { account: null, connectedTo: null };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { account: null, connectedTo: null };
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

/** click.UsageError相当: 標準エラーへ出して終了コード2。 */
function usageError(message, command) {
  process.stderr.write(`Error: ${message}\n\nTry 'protonvpn ${command} --help' for more information.\n`);
  process.exit(2);
}

/** click.ClickException相当: 標準エラーへ出して終了コード1。 */
function clickError(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

/** 標準入力を全て読み、行の配列にする（getpassのTTY無しフォールバック相当）。 */
function readStdinLines() {
  try {
    return readFileSync(0, "utf8").split("\n");
  } catch {
    return [];
  }
}

/** tabulateのsimple形式（左揃え・ヘッダ・区切り行）で表を作る。 */
function table(headers, rows) {
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => row[i].length)));
  const format = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();
  return [format(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(format)].join("\n");
}

const [command, ...rest] = process.argv.slice(2);
const state = loadState();
const requireSignedIn = (message, name) => {
  if (!state.account) usageError(message, name);
};

switch (command) {
  case "signin": {
    const username = rest[0];
    if (!username) usageError("Missing argument 'USERNAME'.", "signin");
    if (state.account) clickError("Already signed in, please sign out first before changing accounts.");
    const [password, twoFactor] = readStdinLines();
    process.stderr.write("Password: ");
    const account = ACCOUNTS[username];
    if (!account || password !== PASSWORD) clickError("Authentication failed. Please check your username and password and try again.");
    if (account.twoFactor && twoFactor !== TWO_FACTOR_CODE) clickError("2FA Authentication failed. Please try again.");
    saveState({ account: { username, ...account }, connectedTo: null });
    console.log(`Successfully signed in as '${username}'`);
    break;
  }
  case "signout": {
    saveState({ account: null, connectedTo: null });
    console.log(state.connectedTo ? "VPN connection terminated and you've been successfully signed out." : "You have been successfully signed out.");
    break;
  }
  case "info": {
    console.log(`Account: '${state.account?.username ?? ""}'`);
    break;
  }
  case "status": {
    console.log(
      state.connectedTo
        ? `Status: Connected\nServer: ${state.connectedTo}\nLoad: 41%\nProtocol: wireguard-udp`
        : "Status: Disconnected",
    );
    break;
  }
  case "connect": {
    requireSignedIn("Authentication required.Please sign in with 'protonvpn signin' before connecting.", "connect");
    // 引数の解釈（--country X / --city X / --p2p / --securecore / --tor / --random / サーバID）。
    let country;
    let city;
    let feature;
    let serverName;
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === "--country") country = rest[++i];
      else if (arg === "--city") city = rest[++i];
      else if (arg === "--p2p") feature = "P2P";
      else if (arg === "-sc" || arg === "--securecore") feature = "Secure Core";
      else if (arg === "--tor") feature = "Tor";
      else if (arg === "--random") feature = "random";
      else serverName = arg;
    }
    if (state.account.plan === "free") {
      if (serverName) usageError("Server selection by ID is not available on the free plan. Please use 'protonvpn connect' to connect to available free servers or upgrade to access all servers.", "connect");
      if (country || city) usageError("Location selection is not available on the free plan. Please use 'protonvpn connect' to connect to available free servers or upgrade to choose your location.", "connect");
      if (feature === "random") usageError("Random selection is not available on the free plan. Please use 'protonvpn connect' to connect to available free servers.", "connect");
      if (feature) usageError(`${feature} servers are not available on the free plan. Please use 'protonvpn connect' to connect to available free servers or upgrade to to access ${feature} servers.`, "connect");
      state.connectedTo = FREE_SERVER;
    } else if (country) {
      const entry = COUNTRIES.find(([name, code]) => code === country.toUpperCase() || name.toLowerCase() === country.toLowerCase());
      if (!entry) usageError(`Invalid country code '${country}'. Please use a valid country code.`, "connect");
      state.connectedTo = `${entry[1]}#12 in ${entry[2]}, ${entry[0]}`;
    } else {
      state.connectedTo = "CH#3 in Zurich, Switzerland";
    }
    saveState(state);
    console.log(`Connected to ${state.connectedTo}. \nYour new IP address is 203.0.113.7.`);
    break;
  }
  case "disconnect": {
    // 実CLI（1.0.3）は、実際の接続を切断したときだけ終了コード1で終わる（メッセージは成功）。未接続なら0。
    const wasConnected = Boolean(state.connectedTo);
    saveState({ ...state, connectedTo: null });
    console.log("Disconnected.");
    if (wasConnected) process.exit(1);
    break;
  }
  case "countries": {
    if (rest[0] !== "list") usageError("Missing command.", "countries");
    requireSignedIn("Authentication required to view complete country list. Please sign in with 'protonvpn signin'", "list");
    console.log(table(["Country", "Code"], COUNTRIES.map(([name, code]) => [name, code])));
    break;
  }
  case "config": {
    if (rest[0] !== "list") usageError("Unsupported config subcommand in the mock.", "config");
    requireSignedIn("Authentication required to view feature status. Please sign in with 'protonvpn signin'", "list");
    // 判定用の表示プラン。`mock-set-probe-plan`で実際のプランと食い違わせられる。
    const free = (state.account.probePlan ?? state.account.plan) === "free";
    // 無料でも使える機能（kill-switch・ipv6・anonymous-crash-reports）以外は、無料版では「Upgrade to enable」になる。
    const settings = [
      ["netshield", free ? "Upgrade to enable" : "off"],
      ["kill-switch", "off"],
      ["ipv6", "on"],
      ["custom-dns", free ? "Upgrade to enable" : "off"],
      ["port-forwarding", free ? "Upgrade to enable" : "off"],
      ["moderate-nat", free ? "Upgrade to enable" : "off"],
      ["vpn-accelerator", free ? "Upgrade to enable" : "on"],
      ["anonymous-crash-reports", "on"],
    ];
    console.log(`\nCurrent configuration\n${table(["Setting", "Value"], settings)}\n`);
    console.log(
      free
        ? "To upgrade to VPN Plus visit: https://account.protonvpn.com/pricing\nAfter upgrading online:\n    Sign out and sign in again to activate your new plan:\n    protonvpn signout && protonvpn signin"
        : "Use 'protonvpn config set <setting> <value>' to change settings.\nUse 'protonvpn config set <setting> --help' for available values.",
    );
    break;
  }
  case "mock-set-probe-plan": {
    if (!state.account || !["free", "paid"].includes(rest[0])) clickError("usage: mock-set-probe-plan <free|paid> (signed in)");
    saveState({ ...state, account: { ...state.account, probePlan: rest[0] } });
    console.log(`probe plan: ${rest[0]}`);
    break;
  }
  default:
    usageError(`No such command '${command ?? ""}'.`, "");
}
