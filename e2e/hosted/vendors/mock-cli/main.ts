// 責務: モック CLI の実行入口。ランナー（dist/runner.js）が、許可されたバイナリのパスとして呼ぶ。
// 呼び出し: node mockvpn.mjs <protonvpn|adguardvpn-cli> <argv...>。stdin は signin のパスワードなどに使う。
// 状態・制御・経路の退避は MOCKVPN_STATE_DIR（既定 /var/lib/mockvpn）に置く。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createNetwork } from "./network";
import { readControl, readState, runCommand, vendorFromBinary, writeState } from "./mockvpn";

/** 同期の待機（応答の遅延の制御に使う）。 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 標準入力を全て読む（端末でない場合のみ。読めなければ空）。 */
function readStdinLines(): string[] {
  try {
    const text = readFileSync(0, "utf8");
    return text === "" ? [] : text.split("\n").filter((line, index, all) => !(index === all.length - 1 && line === ""));
  } catch {
    return [];
  }
}

function main(): void {
  const [binary, ...argv] = process.argv.slice(2);
  if (binary === undefined) {
    process.stderr.write("使い方: mockvpn <呼び出し名> <引数...>\n");
    process.exitCode = 2;
    return;
  }
  const vendor = vendorFromBinary(binary);
  const dir = process.env.MOCKVPN_STATE_DIR ?? "/var/lib/mockvpn";
  const statePath = join(dir, `${vendor}.json`);
  const controlPath = join(dir, `${vendor}.control.json`);

  const state = readState(statePath);
  const control = readControl(controlPath);
  const network = createNetwork(join(dir, `${vendor}.route`));
  const before = JSON.stringify(state);
  const result = runCommand(vendor, argv, state, network, readStdinLines(), control);
  // 状態が変わったときだけ書く（status などの読み取りが、同時に動く別の操作の結果を古い内容で戻さないように）
  if (JSON.stringify(state) !== before) writeState(statePath, state);

  if (control.responseDelayMs !== undefined && control.responseDelayMs > 0) sleepSync(control.responseDelayMs);
  process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
}

main();
