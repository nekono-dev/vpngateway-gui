// 責務: 許可済みバイナリをシェルを経由せずに実行し、結果を構造化して返す。

import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// 子プロセスの'exit'検知後、直前に届いたstdout/stderrの'data'イベントを取りこぼさないための猶予時間。
// 'exit'は子プロセス自身の終了時に発火するが、パイプへの書き込みが同期的に反映され切っているとは限らないため。
const EXIT_FLUSH_GRACE_MS = 50;

/**
 * 目的: `binary`を`argv`で実行し、結果を待ち受ける。
 * 入力: binary(絶対パス、呼び出し元で許可リスト照合済みであること), argv(コマンド引数配列), timeoutMs(タイムアウトms)。
 * 出力: exitCode/stdout/stderrを含むPromise。timeoutMs超過時はexitCode=-1として返す（呼び出し元プロセスをクラッシュさせない）。
 * 実装上の注意: `child_process.execFile`は内部的に子プロセスの`'close'`イベント（stdout/stderrパイプの
 *             ファイルディスクリプタが完全に閉じられるまで）を待つ。実VPNベンダーCLIの`connect`のように、
 *             子プロセスがバックグラウンドにデーモン（孫プロセス）をforkし、そのデーモンが標準出力/エラーの
 *             パイプを引き継いだまま存在し続ける場合、`'close'`は永久に発火せずハングする
 *             （実機検証で発覚。wbs/phase2.md「次フェーズへの申し送り」参照）。
 *             そのため本関数は`spawn`を使い、子プロセス自身の終了を表す`'exit'`イベントのみを待つ
 *             （`runDetachableCommand`と同じ方式に統一）。
 * 例: runCommand("/usr/local/bin/adguardvpn-cli", ["status"], 5000)
 */
export function runCommand(
  binary: string,
  argv: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    // シェルを経由せずspawnするため、argv内にシェルメタ文字が含まれても解釈されない。
    const child = spawn(binary, argv, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ exitCode: -1, stdout, stderr });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 直前に届いた'data'イベントの取りこぼしを防ぐための短い猶予。
      setTimeout(() => resolve({ exitCode: code ?? -1, stdout, stderr }), EXIT_FLUSH_GRACE_MS);
    });

    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr });
    });
  });
}

export interface DetachableCommandResult {
  // null: completionPatternに一致し応答した時点で、プロセスはまだ終了していないことを表す。
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface BackgroundExitInfo {
  exitCode: number;
  // true: 自然終了ではなく、backgroundTimeoutMs超過によりこちらから強制killした。
  killedByTimeout: boolean;
}

// completionPattern一致後、プロセスが自然終了しない場合に強制killするまでの猶予（デフォルト30分）。
// 実VPNベンダーCLIの`login`はブラウザでの認証完了まで数分〜最大約30分かかりうるため
// （wbs/phase2.md参照）、それに合わせた値とする。
const DEFAULT_BACKGROUND_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * 目的: `binary`を`argv`で実行し、プロセスの終了を待たずstdoutが`completionPattern`に一致した時点で応答する。
 *       一致後もプロセス自体はkillせずバックグラウンドで実行を継続させるが、無期限には放置しない
 *       （下記「実装上の注意」参照）。
 * 入力: binary/argv(runCommandと同様), timeoutMs(completionPatternに一致するまでの最大待機時間ms),
 *      completionPattern(正規表現ソース文字列), options.backgroundTimeoutMs(completionPattern一致後、
 *      プロセスが自然終了しない場合に強制killするまでの猶予ms。省略時30分),
 *      options.onBackgroundExit(バックグラウンド継続後の最終的な終了を通知するコールバック。省略可)。
 * 出力: exitCode/stdout/stderrを含むPromise。
 *       - completionPatternに一致: exitCode=null（この時点のstdout/stderrを含む。プロセスは実行継続中）。
 *       - 一致せずプロセスが終了: 実際のexitCode。
 *       - 一致せずtimeoutMsを超過: プロセスをkillしexitCode=-1（runCommandのタイムアウト表現と統一）。
 * 用途: ログイン代行（`login`）のように、ブラウザでの認証完了まで数分かかる長時間プロセスが、
 *      途中でログインURLを出力した時点で呼び出し元に応答を返す必要がある場合
 *      （proxyserver/design.md「実VPNベンダーCLI統合・ログイン代行 (Phase 2)」参照）。
 * 実装上の注意: 実機検証で、認証完了後もCLI内部の確認入力待ち処理がstdin終端（`stdio:"ignore"`は
 *             読み取り時に即座にEOFとなる）を正しく扱えず、`ConsoleIOImpl get_char`のエラーを
 *             ログに出し続けるビジーループに陥り、プロセスが自然終了しない不具合を確認した
 *             （wbs/phase2.md「次フェーズへの申し送り」参照）。この種の異常なCPU消費を避けるため、
 *             stdinは`"ignore"`ではなく書き込みを行わない`"pipe"`とし、読み取りをブロックさせる
 *             （即時EOFより安全）。加えて、上記のような不具合でプロセスが自然終了しないケースに
 *             備え、`backgroundTimeoutMs`経過後は強制killしてプロセスの無期限な滞留を防ぐ。
 * 例: runDetachableCommand("/usr/local/bin/adguardvpn-cli", ["login"], 15000, "https://\\S+")
 */
export function runDetachableCommand(
  binary: string,
  argv: string[],
  timeoutMs: number,
  completionPattern: string,
  options?: {
    backgroundTimeoutMs?: number;
    onBackgroundExit?: (result: BackgroundExitInfo) => void;
  },
): Promise<DetachableCommandResult> {
  const backgroundTimeoutMs = options?.backgroundTimeoutMs ?? DEFAULT_BACKGROUND_TIMEOUT_MS;
  const onBackgroundExit = options?.onBackgroundExit;

  return new Promise((resolve) => {
    const pattern = new RegExp(completionPattern);
    // シェルを経由せずspawnするため、argv内にシェルメタ文字が含まれても解釈されない。
    // stdinは"pipe"のまま書き込みを行わない（上記「実装上の注意」参照）。
    const child = spawn(binary, argv, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
    // 強制kill後も対象プロセスの'exit'イベント自体は発火するため、onBackgroundExitの二重通知を防ぐ。
    let backgroundSettled = false;
    // 'exit'で観測した終了コード。猶予中にcompletionPatternへ一致した場合の後始末に用いる。
    let exitedCode: number | undefined;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ exitCode: -1, stdout, stderr });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (!settled && pattern.test(stdout)) {
        settled = true;
        clearTimeout(timer);
        // プロセスはkillせずバックグラウンドで認証待ち等を継続させるが、無期限には放置しない。
        child.unref();
        backgroundTimer = setTimeout(() => {
          if (backgroundSettled) return;
          backgroundSettled = true;
          child.kill("SIGKILL");
          onBackgroundExit?.({ exitCode: -1, killedByTimeout: true });
        }, backgroundTimeoutMs);
        backgroundTimer.unref();
        resolve({ exitCode: null, stdout, stderr });
        // すでに終了済み（猶予中の一致）なら、バックグラウンド終了を即座に通知して後始末する。
        if (exitedCode !== undefined) {
          backgroundSettled = true;
          clearTimeout(backgroundTimer);
          onBackgroundExit?.({ exitCode: exitedCode, killedByTimeout: false });
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("exit", (code) => {
      exitedCode = code ?? -1;
      if (!settled) {
        // 出力直後に終了したプロセスでは、'exit'が最後のstdout'data'より先に処理されうる
        // （runCommandと同じ理由。これを猶予なしで確定すると、completionPatternに一致する出力を
        // 取りこぼして終了コードを返してしまう。間欠的なテスト失敗として顕在化した）。
        // 猶予中にdataで一致すれば、一致側がすでに応答しているためここでは何もしない。
        setTimeout(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ exitCode: exitedCode ?? -1, stdout, stderr });
        }, EXIT_FLUSH_GRACE_MS);
        return;
      }
      // completionPattern一致後（バックグラウンド継続中）の自然終了。
      if (backgroundSettled) return;
      backgroundSettled = true;
      if (backgroundTimer) clearTimeout(backgroundTimer);
      onBackgroundExit?.({ exitCode: code ?? -1, killedByTimeout: false });
    });

    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr });
    });
  });
}
