// 責務: 明示的プロキシ（3proxy）プロセスの起動・停止・監視・異常終了時の再起動（指数バックオフ）と、
// 現在の稼働状況（`GET /status`用）の保持。設定内容の文字列化はconfig-builder.tsが担い、
// 本ファイルは「いつ起動・再起動・停止するか」の調停のみを行う（GatewayControllerと同じ責務分離）。
// VPN接続状態の変化では再起動しない（3proxyはOSのルーティングに自動追従するため。proxyserver/design.md参照）。

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildExplicitProxyConfig } from "./config-builder.js";

export interface ExplicitProxySettings {
  enabled: boolean;
  allowedCidrs: readonly string[];
}

// active: 稼働中（一時的な再起動待ちを含む） / stopped: 無効 / unconfigured: 有効設定だが許可CIDRが空 /
// crashLoop: 起動直後の異常終了を連続して繰り返している / error: 設定ファイルの生成・書き込みに失敗。
export type ExplicitProxyState = "active" | "stopped" | "unconfigured" | "crashLoop" | "error";

// `GET /status`が返す稼働状況（apiserver/design.md「稼働状況取得」と同形状）。
export interface ExplicitProxyStatus {
  state: ExplicitProxyState;
  // 稼働中（state=active）のみ含める。
  socksPort?: number;
  httpPort?: number;
  // プロセス起動以降の異常終了による再起動回数（設定変更による意図的な再起動は含めない）。
  restartCount: number;
}

// 3proxyプロセスに対して本コントローラが必要とする最小限の操作（テストで差し替えるための境界）。
export interface ProxyProcess {
  kill(signal: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface ExplicitProxyControllerOptions {
  binaryPath: string;
  configPath: string;
  socksPort: number;
  httpPort: number;
  // 監査ログ等への出力先。省略時は何もしない。
  onEvent?: (event: Record<string, unknown>) => void;
  // 以下はテスト用フック（既定は実プロセス・実ファイルシステム・実時計）。
  spawnProcess?: (binaryPath: string, configPath: string) => ProxyProcess;
  writeConfigFile?: (path: string, content: string) => void;
  now?: () => number;
  // 再起動待ちの初回遅延(ms)。以後、連続失敗ごとに2倍し`maxBackoffMs`で頭打ちにする。
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  // この時間以上稼働し続けたら安定とみなし、連続失敗回数・バックオフをリセットする。
  stableUptimeMs?: number;
  // 連続失敗がこの回数に達したらcrashLoopとして報告する。
  crashLoopThreshold?: number;
  // SIGTERM送出後、この時間内に終了しなければSIGKILLする。3proxyはSIGTERMを受けてから終了するまでに
  // 約5秒かかる（実機で計測）ため、それより十分長い値を既定とする。
  killTimeoutMs?: number;
}

/**
 * 目的: 3proxyの設定ファイルを原子的に書き出す（一時ファイル→rename）。読み取り途中の欠けた設定を
 *      3proxyが読まないようにするため。
 * 入力: path(出力先), content(全文)。
 * 出力: なし。失敗時は例外（呼び出し元がerror状態として扱う）。
 * 副作用: ディレクトリ作成・ファイル書き込みを行う。
 */
function writeConfigFileAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, content, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

/**
 * 目的: 実際に3proxyプロセスを起動する。標準出力・標準エラーはコンテナのログへそのまま流す。
 * 入力: binaryPath(3proxy実行ファイル), configPath(設定ファイル)。
 * 出力: 起動した子プロセス。起動失敗（ENOENT等）は'error'イベントで通知される。
 */
function spawnRealProcess(binaryPath: string, configPath: string): ChildProcess {
  return spawn(binaryPath, [configPath], { stdio: ["ignore", "inherit", "inherit"] });
}

export class ExplicitProxyController {
  private readonly options: Required<Omit<ExplicitProxyControllerOptions, "onEvent">> &
    Pick<ExplicitProxyControllerOptions, "onEvent">;
  private settings: ExplicitProxySettings = { enabled: false, allowedCidrs: [] };
  // 一度でも設定を受信したか（APIの定期再通知で変更がない場合に何もしない判定に用いる）。
  private hasApplied = false;
  private child: ProxyProcess | undefined;
  private childStartedAt = 0;
  // 意図的にkillした（設定変更・停止）子プロセス。異常終了と区別して再起動待ちに入れないために保持する。
  private readonly expectedExits = new WeakSet<ProxyProcess>();
  private restartTimer: NodeJS.Timeout | undefined;
  private stableTimer: NodeJS.Timeout | undefined;
  private killTimer: NodeJS.Timeout | undefined;
  private consecutiveFailures = 0;
  private restartCount = 0;
  private configFailed = false;

  constructor(options: ExplicitProxyControllerOptions) {
    this.options = {
      spawnProcess: spawnRealProcess,
      writeConfigFile: writeConfigFileAtomically,
      now: Date.now,
      baseBackoffMs: 1_000,
      maxBackoffMs: 60_000,
      stableUptimeMs: 30_000,
      crashLoopThreshold: 3,
      killTimeoutMs: 10_000,
      ...options,
    };
  }

  /**
   * 目的: ユーザ向け設定（explicitProxyEnabled/explicitProxyAllowedCidrs）の最新値を反映し、
   *      3proxyを起動・再起動・停止する。
   * 入力: settings(APIサーバから`POST /settings`で通知された最新値の一部)。
   * 出力: なし。同期的に状態を更新する（プロセスの終了待ちが必要な再起動は終了イベントで完了する）。
   * 失敗時の方針: 設定ファイルの生成・書き込み失敗は例外にせずerror状態として保持し、監査イベントを出す
   *              （`POST /settings`自体は成功させ、次回の再通知で再試行する）。
   * 副作用: 設定ファイル書き込み、子プロセスの起動・終了。APIは設定を定期再通知するため、前回と同じ内容で
   *        正常に反映済みなら何もしない（不要な再起動でプロキシ接続を切らないため）。
   * 例: controller.applySettings({ enabled: true, allowedCidrs: ["192.168.3.0/24"] })
   */
  applySettings(settings: ExplicitProxySettings): void {
    const unchanged =
      this.hasApplied &&
      !this.configFailed &&
      settings.enabled === this.settings.enabled &&
      settings.allowedCidrs.length === this.settings.allowedCidrs.length &&
      settings.allowedCidrs.every((cidr, index) => cidr === this.settings.allowedCidrs[index]);
    this.settings = { enabled: settings.enabled, allowedCidrs: [...settings.allowedCidrs] };
    this.hasApplied = true;
    if (unchanged) return;

    // 設定変更は新しい状況とみなし、過去のクラッシュ履歴・バックオフを持ち越さない。
    this.consecutiveFailures = 0;
    this.cancelRestartTimer();
    this.configFailed = false;

    if (!this.isRunnable()) {
      this.stopChild();
      return;
    }

    try {
      this.options.writeConfigFile(
        this.options.configPath,
        buildExplicitProxyConfig({
          allowedCidrs: this.settings.allowedCidrs,
          socksPort: this.options.socksPort,
          httpPort: this.options.httpPort,
        }),
      );
    } catch (error) {
      this.configFailed = true;
      this.stopChild();
      this.emit({ event: "explicit_proxy_config_error", message: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (this.child !== undefined) {
      // 旧プロセスがポートを解放してから新設定で起動する（終了イベントで起動する）。
      this.stopChild();
    } else {
      this.startChild();
    }
  }

  /**
   * 目的: メモリ上の現在状態から稼働状況を導出する（`GET /status`用）。プロセスの実在確認のための
   *      外部コマンド実行は行わない。
   * 入力: なし。
   * 出力: ExplicitProxyStatus。
   * 例: controller.getStatus() // => { state: "active", socksPort: 1080, httpPort: 3128, restartCount: 0 }
   */
  getStatus(): ExplicitProxyStatus {
    const restartCount = this.restartCount;
    if (!this.settings.enabled) return { state: "stopped", restartCount };
    if (this.settings.allowedCidrs.length === 0) return { state: "unconfigured", restartCount };
    if (this.configFailed) return { state: "error", restartCount };
    if (this.consecutiveFailures >= this.options.crashLoopThreshold) return { state: "crashLoop", restartCount };
    return {
      state: "active",
      socksPort: this.options.socksPort,
      httpPort: this.options.httpPort,
      restartCount,
    };
  }

  private isRunnable(): boolean {
    return this.settings.enabled && this.settings.allowedCidrs.length > 0;
  }

  private emit(event: Record<string, unknown>): void {
    this.options.onEvent?.(event);
  }

  private cancelRestartTimer(): void {
    if (this.restartTimer !== undefined) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
  }

  /**
   * 目的: 3proxyを起動し、終了・起動失敗の監視を仕掛ける。
   * 副作用: 子プロセス生成。安定稼働判定用のタイマーを張る（unrefし、プロセス終了を妨げない）。
   */
  private startChild(): void {
    const child = this.options.spawnProcess(this.options.binaryPath, this.options.configPath);
    this.child = child;
    this.childStartedAt = this.options.now();
    this.emit({ event: "explicit_proxy_started", socksPort: this.options.socksPort, httpPort: this.options.httpPort });

    // 起動失敗（ENOENT等）では'exit'が来ない場合があるため、'error'も終了として扱う。二重処理は
    // handleTerminationの`this.child !== child`判定で除外される。
    child.on("exit", (code, signal) => this.handleTermination(child, `exit code=${code} signal=${signal}`));
    child.on("error", (error) => this.handleTermination(child, `error ${error.message}`));

    this.stableTimer = setTimeout(() => {
      this.consecutiveFailures = 0;
    }, this.options.stableUptimeMs);
    this.stableTimer.unref();
  }

  /**
   * 目的: 稼働中の3proxyを停止する（SIGTERM、応答が無ければSIGKILL）。子がいなければ何もしない。
   * 副作用: 意図的な終了として記録するため、終了イベントで異常終了扱い（再起動待ち）にならない。
   */
  private stopChild(): void {
    const child = this.child;
    if (child === undefined) return;
    this.expectedExits.add(child);
    child.kill("SIGTERM");
    // 終了待ちの間に設定が再変更され再度呼ばれても、SIGKILL用タイマーが重複して残らないようにする。
    if (this.killTimer !== undefined) clearTimeout(this.killTimer);
    this.killTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, this.options.killTimeoutMs);
    this.killTimer.unref();
  }

  /**
   * 目的: 子プロセスの終了を処理する。意図的な終了なら（有効設定が残っていれば）即座に再起動し、
   *      異常終了なら指数バックオフで再起動を予約する。
   * 入力: child(終了した子プロセス), reason(監査ログ用の終了理由)。
   * 分岐の意図: すでに別の子に置き換わっている、または同一子の'exit'と'error'の二重通知は無視する。
   */
  private handleTermination(child: ProxyProcess, reason: string): void {
    if (this.child !== child) return;
    this.child = undefined;
    if (this.stableTimer !== undefined) clearTimeout(this.stableTimer);
    if (this.killTimer !== undefined) clearTimeout(this.killTimer);
    this.stableTimer = undefined;
    this.killTimer = undefined;

    if (this.expectedExits.has(child)) {
      this.emit({ event: "explicit_proxy_stopped", reason });
      if (this.isRunnable() && !this.configFailed) this.startChild();
      return;
    }

    if (this.options.now() - this.childStartedAt >= this.options.stableUptimeMs) {
      this.consecutiveFailures = 0;
    }
    this.consecutiveFailures += 1;
    this.restartCount += 1;
    const delayMs = Math.min(
      this.options.baseBackoffMs * 2 ** (this.consecutiveFailures - 1),
      this.options.maxBackoffMs,
    );
    this.emit({
      event: this.consecutiveFailures >= this.options.crashLoopThreshold ? "explicit_proxy_crash_loop" : "explicit_proxy_crashed",
      reason,
      consecutiveFailures: this.consecutiveFailures,
      restartInMs: delayMs,
    });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.isRunnable() && !this.configFailed && this.child === undefined) this.startChild();
    }, delayMs);
    this.restartTimer.unref();
  }
}
