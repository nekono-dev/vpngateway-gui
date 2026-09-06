#!/usr/bin/env node
// 責務: 実VPNベンダーCLI（adguardvpn-cli相当）の代わりにPhase 1で使用するモック実装。
// specs/proxyserver/design.md「Phase 1: モックVPN CLI仕様」参照。
// 状態は環境変数MOCK_STATE_FILEで指定するファイル（省略時は/tmp/vpngwgui-mock-state.json）に保存する。

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const stateFilePath = process.env.MOCK_STATE_FILE ?? "/tmp/vpngwgui-mock-state.json";

function readState() {
  if (!existsSync(stateFilePath)) {
    return { status: "disconnected" };
  }
  return JSON.parse(readFileSync(stateFilePath, "utf8"));
}

function writeState(state) {
  writeFileSync(stateFilePath, JSON.stringify(state));
}

function printUsageAndExit() {
  process.stderr.write("usage: adguardvpn-cli-mock connection [-l <COUNTRY>|-d|-s]\n");
  process.exit(2);
}

const args = process.argv.slice(2);

if (args[0] !== "connection") {
  printUsageAndExit();
}

const subcommand = args[1];

if (subcommand === "-l") {
  const country = args[2];
  // テスト専用のエラー注入: 実CLIなしでAPI側の422ハンドリングを検証するための特殊国コード。
  if (country === "zz") {
    process.stderr.write("ERROR: no server available for zz\n");
    process.exit(1);
  }
  const state = { status: "connected", country };
  writeState(state);
  process.stdout.write(JSON.stringify(state) + "\n");
  process.exit(0);
} else if (subcommand === "-d") {
  const state = { status: "disconnected" };
  writeState(state);
  process.stdout.write(JSON.stringify(state) + "\n");
  process.exit(0);
} else if (subcommand === "-s") {
  const state = readState();
  process.stdout.write(JSON.stringify(state) + "\n");
  process.exit(0);
} else {
  printUsageAndExit();
}
