// 責務: 明示的プロキシ（3proxy）の設定と起動の調停の受け入れテスト。
// 受け入れ条件 proxyserver/AC-5・AC-23 を、設定ファイルの生成関数と、プロセス・時計を差し替えたコントローラで確認する。

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildExplicitProxyConfig } from "../../proxy/src/explicit-proxy/config-builder.js";
import { ExplicitProxyController, type ProxyProcess } from "../../proxy/src/explicit-proxy/explicit-proxy-controller.js";

/** 目的: 3proxyプロセスの代役。テストから任意の時点で終了させる。 */
class FakeProcess implements ProxyProcess {
  private exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  kill(signal: NodeJS.Signals): boolean {
    queueMicrotask(() => this.emitExit(null, signal));
    return true;
  }
  on(event: "exit" | "error", listener: never): this {
    if (event === "exit") this.exitListeners.push(listener);
    return this;
  }
  emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitListeners.forEach((listener) => listener(code, signal));
  }
}

afterEach(() => {
  vi.useRealTimers();
});

/** 目的: プロセスを差し替えたコントローラと、起動したプロセスの一覧・書き出した設定を返す。 */
function setup() {
  const processes: FakeProcess[] = [];
  const writes: string[] = [];
  const events: Array<Record<string, unknown>> = [];
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
    writeConfigFile: (_path, content) => writes.push(content),
    onEvent: (event) => events.push(event),
  });
  return { controller, processes, writes, events };
}

describe("明示的プロキシ", () => {
  it("proxyserver/AC-5: 設定は許可元以外を拒否し、許可元が空のときは起動しない", () => {
    const config = buildExplicitProxyConfig({ allowedCidrs: ["192.168.3.0/24", "10.0.0.0/8"], socksPort: 1080, httpPort: 3128 });
    const lines = config.split("\n").filter(Boolean);
    expect(lines).toEqual(["auth iponly", "allow * 192.168.3.0/24,10.0.0.0/8", "deny *", "socks -p1080", "proxy -p3128"]);
    // 許可元の末尾に拒否の規則が置かれ、許可元より後ろに許可の規則が無い。
    expect(lines.indexOf("deny *")).toBeGreaterThan(lines.findIndex((line) => line.startsWith("allow")));
    // 設定行を注入できる値と、プレフィックス長のない単一ホスト表記は拒否される。
    expect(() => buildExplicitProxyConfig({ allowedCidrs: ["192.168.3.0/24\nallow * 0.0.0.0/0"], socksPort: 1080, httpPort: 3128 })).toThrow();
    expect(() => buildExplicitProxyConfig({ allowedCidrs: ["192.168.3.5"], socksPort: 1080, httpPort: 3128 })).toThrow();
    expect(() => buildExplicitProxyConfig({ allowedCidrs: [], socksPort: 1080, httpPort: 3128 })).toThrow();

    const { controller, processes } = setup();
    controller.applySettings({ enabled: true, allowedCidrs: [] });
    expect(controller.getStatus().state).toBe("unconfigured");
    expect(processes).toHaveLength(0);
    controller.applySettings({ enabled: true, allowedCidrs: ["192.168.3.0/24"] });
    expect(controller.getStatus()).toMatchObject({ state: "active", socksPort: 1080, httpPort: 3128 });
    expect(processes).toHaveLength(1);
  });

  it("proxyserver/AC-23: 再起動の間隔は1秒から倍々に延び、60秒で頭打ちになる", () => {
    vi.useFakeTimers();
    const { controller, processes, events } = setup();
    controller.applySettings({ enabled: true, allowedCidrs: ["192.168.3.0/24"] });
    // 起動直後の異常終了を繰り返し、再起動の予約の間隔を記録する。
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const current = processes.at(-1) as FakeProcess;
      current.emitExit(1);
      const delay = events.filter((event) => typeof event.restartInMs === "number").at(-1)?.restartInMs as number;
      vi.advanceTimersByTime(delay);
    }
    const delays = events.filter((event) => typeof event.restartInMs === "number").map((event) => event.restartInMs);
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    // 連続して異常終了すると、起動の繰り返しとして報告される。
    expect(controller.getStatus().state).toBe("crashLoop");
  });
});
