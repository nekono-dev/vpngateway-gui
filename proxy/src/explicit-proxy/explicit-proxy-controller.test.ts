// 責務: ExplicitProxyController（3proxyの起動・停止・再起動・クラッシュループ検知）の単体テスト。
// 実プロセス・実ファイルシステム・実時計には依存せず、spawn/書き込み/時計のフックへスタブを注入して検証する。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExplicitProxyController, type ProxyProcess } from "./explicit-proxy-controller.js";

// 3proxyプロセスの代役。テストから任意のタイミングで終了・起動失敗を発生させる。
class FakeProcess implements ProxyProcess {
  readonly signals: NodeJS.Signals[] = [];
  private exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  private errorListeners: Array<(error: Error) => void> = [];
  // SIGTERMに応答して終了するか（falseならSIGKILLまで終了しない）。
  respondsToSigterm = true;

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (signal === "SIGKILL" || this.respondsToSigterm) {
      queueMicrotask(() => this.emitExit(null, signal));
    }
    return true;
  }

  on(event: "exit" | "error", listener: never): this {
    if (event === "exit") this.exitListeners.push(listener);
    else this.errorListeners.push(listener);
    return this;
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitListeners.forEach((listener) => listener(code, signal));
  }

  emitError(error: Error): void {
    this.errorListeners.forEach((listener) => listener(error));
  }
}

const CIDRS = ["192.168.3.0/24"];

function setup(overrides: Record<string, unknown> = {}) {
  const processes: FakeProcess[] = [];
  const writes: Array<{ path: string; content: string }> = [];
  const events: Array<Record<string, unknown>> = [];
  let clock = 0;
  const controller = new ExplicitProxyController({
    binaryPath: "/usr/local/bin/3proxy",
    configPath: "/tmp/3proxy.cfg",
    socksPort: 1080,
    httpPort: 3128,
    spawnProcess: () => {
      const process = new FakeProcess();
      processes.push(process);
      return process;
    },
    writeConfigFile: (path, content) => {
      writes.push({ path, content });
    },
    now: () => clock,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  return {
    controller,
    processes,
    writes,
    events,
    advanceClock: (ms: number) => {
      clock += ms;
    },
  };
}

describe("ExplicitProxyController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("初期状態と無効設定では起動せずstopped", () => {
    const { controller, processes } = setup();
    expect(controller.getStatus()).toEqual({ state: "stopped", restartCount: 0 });
    controller.applySettings({ enabled: false, allowedCidrs: CIDRS });
    expect(processes).toHaveLength(0);
    expect(controller.getStatus().state).toBe("stopped");
  });

  it("有効かつCIDRありなら設定ファイルを書いて起動し、active（ポート付き）になる", () => {
    const { controller, processes, writes } = setup();
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    expect(processes).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toContain("allow * 192.168.3.0/24");
    expect(controller.getStatus()).toEqual({ state: "active", socksPort: 1080, httpPort: 3128, restartCount: 0 });
  });

  it("有効でもCIDRが空なら起動せずunconfigured", () => {
    const { controller, processes } = setup();
    controller.applySettings({ enabled: true, allowedCidrs: [] });
    expect(processes).toHaveLength(0);
    expect(controller.getStatus().state).toBe("unconfigured");
  });

  it("同一設定の再通知（APIの定期再通知）では再起動しない", () => {
    const { controller, processes, writes } = setup();
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    controller.applySettings({ enabled: true, allowedCidrs: [...CIDRS] });
    expect(processes).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect(processes[0].signals).toEqual([]);
  });

  it("CIDR変更では旧プロセスの終了後に新設定で起動し、異常終了として数えない", async () => {
    const { controller, processes, writes } = setup();
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    controller.applySettings({ enabled: true, allowedCidrs: ["10.0.0.0/8"] });
    // 旧プロセスの終了待ちの間は新プロセスを起動しない（ポート競合の回避）。
    expect(processes).toHaveLength(1);
    expect(processes[0].signals).toEqual(["SIGTERM"]);
    await Promise.resolve();
    expect(processes).toHaveLength(2);
    expect(writes[1].content).toContain("allow * 10.0.0.0/8");
    expect(controller.getStatus()).toMatchObject({ state: "active", restartCount: 0 });
  });

  it("無効化すると停止し、再起動しない", async () => {
    const { controller, processes } = setup();
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    controller.applySettings({ enabled: false, allowedCidrs: CIDRS });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(processes).toHaveLength(1);
    expect(processes[0].signals).toEqual(["SIGTERM"]);
    expect(controller.getStatus().state).toBe("stopped");
  });

  it("SIGTERMに応答しない場合はSIGKILLで強制終了する", async () => {
    const { controller, processes } = setup({ killTimeoutMs: 5_000 });
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    processes[0].respondsToSigterm = false;
    controller.applySettings({ enabled: false, allowedCidrs: CIDRS });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(processes[0].signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("異常終了すると指数バックオフで再起動する（1秒→2秒→…）", async () => {
    const { controller, processes } = setup({ baseBackoffMs: 1_000, crashLoopThreshold: 5 });
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });

    processes[0].emitExit(1);
    expect(processes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(processes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(processes).toHaveLength(2);

    processes[1].emitExit(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(processes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(processes).toHaveLength(3);
    expect(controller.getStatus().restartCount).toBe(2);
  });

  it("バックオフはmaxBackoffMsで頭打ちになる", async () => {
    const { controller, processes } = setup({ baseBackoffMs: 1_000, maxBackoffMs: 3_000, crashLoopThreshold: 10 });
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    for (let index = 0; index < 4; index += 1) {
      processes[index].emitExit(1);
      await vi.advanceTimersByTimeAsync(3_000);
    }
    // 4回目の失敗の遅延は 1,2,3,3 秒（4秒ではなく3秒で再起動している）。
    expect(processes).toHaveLength(5);
  });

  it("連続失敗がしきい値に達するとcrashLoopを報告し、安定稼働すると回復する", async () => {
    const { controller, processes, events } = setup({
      crashLoopThreshold: 3,
      baseBackoffMs: 1_000,
      stableUptimeMs: 30_000,
    });
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    // 安定稼働タイマー(30秒)より短い間隔で失敗を繰り返す（遅延は1秒→2秒→4秒）。
    for (const delayMs of [1_000, 2_000, 4_000]) {
      processes[processes.length - 1].emitExit(1);
      await vi.advanceTimersByTimeAsync(delayMs);
    }
    expect(processes).toHaveLength(4);
    expect(events.some((event) => event.event === "explicit_proxy_crash_loop")).toBe(true);
    // 再起動は試み続け、そのプロセスが安定稼働時間を超えて生き続ければcrashLoopは解消する。
    await vi.advanceTimersByTimeAsync(30_000);
    expect(controller.getStatus().state).toBe("active");
  });

  it("crashLoop中（再起動待ち）の状態を報告する", async () => {
    const { controller, processes } = setup({ crashLoopThreshold: 2, baseBackoffMs: 10_000 });
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    processes[0].emitExit(1);
    await vi.advanceTimersByTimeAsync(10_000);
    processes[1].emitExit(1);
    expect(controller.getStatus()).toEqual({ state: "crashLoop", restartCount: 2 });
  });

  it("起動失敗（errorイベントのみでexitが来ない）も異常終了として再起動を予約する", async () => {
    const { controller, processes } = setup({ baseBackoffMs: 1_000 });
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    processes[0].emitError(new Error("spawn 3proxy ENOENT"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(processes).toHaveLength(2);
  });

  it("同一プロセスのerrorとexitの二重通知は1回の異常終了として扱う", async () => {
    const { controller, processes } = setup({ baseBackoffMs: 1_000 });
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    processes[0].emitError(new Error("boom"));
    processes[0].emitExit(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(processes).toHaveLength(2);
    expect(controller.getStatus().restartCount).toBe(1);
  });

  it("再起動待ちの間に設定が変更されたら、待たずに新設定で起動する", async () => {
    const { controller, processes, writes } = setup({ baseBackoffMs: 30_000 });
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    processes[0].emitExit(1);
    controller.applySettings({ enabled: true, allowedCidrs: ["10.0.0.0/8"] });
    expect(processes).toHaveLength(2);
    expect(writes[1].content).toContain("10.0.0.0/8");
  });

  it("再起動待ちの間に無効化されたら再起動しない", async () => {
    const { controller, processes } = setup({ baseBackoffMs: 1_000 });
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    processes[0].emitExit(1);
    controller.applySettings({ enabled: false, allowedCidrs: CIDRS });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(processes).toHaveLength(1);
  });

  it("設定ファイルの書き込みに失敗したらerror状態になり、次回の再通知で再試行する", () => {
    let failing = true;
    const { controller, processes, events } = setup({
      writeConfigFile: () => {
        if (failing) throw new Error("EACCES");
      },
    });
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    expect(controller.getStatus().state).toBe("error");
    expect(processes).toHaveLength(0);
    expect(events.some((event) => event.event === "explicit_proxy_config_error")).toBe(true);

    failing = false;
    controller.applySettings({ enabled: true, allowedCidrs: CIDRS });
    expect(processes).toHaveLength(1);
    expect(controller.getStatus().state).toBe("active");
  });

  it("不正なCIDRが混入しても（APIの検証をすり抜けた場合）起動せずerror状態になる", () => {
    const { controller, processes } = setup({ writeConfigFile: undefined });
    controller.applySettings({ enabled: true, allowedCidrs: ["not-a-cidr"] });
    expect(processes).toHaveLength(0);
    expect(controller.getStatus().state).toBe("error");
  });
});
