// 責務: ランナーのプロセス全体（起点 `proxy/src/runner.ts`）を実際に起動して確認する受け入れテスト。
// 受け入れ条件 runner/AC-6・AC-10・AC-17 を、Unixドメインソケット越しの稼働確認で検証する。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoPath } from "../helpers/repo.js";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-accept-runner-proc-"));
const socketPath = join(dir, "runner-test.sock");
const allowedBinary = "/usr/local/bin/vendor-cli-for-test";
let child: ChildProcess;

/** 目的: ソケットが作られるまで待つ。失敗時は例外。 */
async function waitForSocket(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error("runner socket was not created in time");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 目的: ソケットへ GET /health を送り、応答と所要時間（ミリ秒）を返す。 */
function getHealth(): Promise<{ status: number; json: Record<string, unknown>; elapsedMs: number }> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = request({ socketPath, path: "/health", method: "GET" }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk.toString("utf8")));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, json: JSON.parse(data) as Record<string, unknown>, elapsedMs: performance.now() - started }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

/** 目的: /proc/net/tcp(6) から、LISTEN状態のソケットのinode集合を返す。 */
function listeningTcpInodes(): Set<string> {
  const inodes = new Set<string>();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
      const columns = line.trim().split(/\s+/);
      // 4列目がソケットの状態（0A = LISTEN）、10列目がinode。
      if (columns[3] === "0A" && columns[9] !== undefined) inodes.add(columns[9]);
    }
  }
  return inodes;
}

beforeAll(async () => {
  child = spawn(repoPath("node_modules/.bin/tsx"), [repoPath("proxy/src/runner.ts")], {
    env: { ...process.env, CTL_SOCKET_PATH: socketPath, RUNNER_ALLOWED_BINARY: allowedBinary },
    stdio: "ignore",
  });
  await waitForSocket(socketPath, 20000);
});

afterAll(() => {
  child.kill("SIGTERM");
});

describe("ランナーのプロセス", () => {
  it("runner/AC-6: 稼働確認の応答に、許可バイナリの絶対パスが含まれる", async () => {
    const { status, json } = await getHealth();
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, binary: allowedBinary });
  });

  it("runner/AC-10: Unixドメインソケットだけで待ち受け、ソケットの権限が所有者とグループに限られる", () => {
    expect(statSync(socketPath).mode & 0o777).toBe(0o770);
    // 起動したプロセスが保持するソケットのうち、TCPでLISTENしているものが無い。
    const pid = child.pid;
    expect(pid).toBeDefined();
    const listening = listeningTcpInodes();
    // tsx は子のnodeプロセスを起こすため、プロセスツリー全体のfdを調べる。
    const pids = [pid as number, ...childPids(pid as number)];
    const heldInodes = pids.flatMap((p) => socketInodesOf(p));
    expect(heldInodes.filter((inode) => listening.has(inode))).toEqual([]);
  });

  it("runner/AC-17: 稼働確認は、受付の開始後100ミリ秒以内に応答する", async () => {
    // 初回の接続確立を除いた2回目以降の応答時間で判定する。
    await getHealth();
    const { elapsedMs } = await getHealth();
    expect(elapsedMs).toBeLessThan(100);
  });
});

// 目的: 指定プロセスの子孫のPIDを返す（procfsのchildrenファイルを再帰的にたどる）。
function childPids(pid: number): number[] {
  const result: number[] = [];
  const childrenFile = `/proc/${pid}/task/${pid}/children`;
  if (!existsSync(childrenFile)) return result;
  for (const text of readFileSync(childrenFile, "utf8").split(/\s+/).filter(Boolean)) {
    const childPid = Number(text);
    result.push(childPid, ...childPids(childPid));
  }
  return result;
}

/** 目的: 指定プロセスが開いているソケットのinode一覧を返す。 */
function socketInodesOf(pid: number): string[] {
  const fdDir = `/proc/${pid}/fd`;
  if (!existsSync(fdDir)) return [];
  const inodes: string[] = [];
  for (const fd of readdirSync(fdDir)) {
    try {
      const target = readlinkSync(join(fdDir, fd));
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (match?.[1] !== undefined) inodes.push(match[1]);
    } catch {
      // fdが閉じられた場合は無視する。
    }
  }
  return inodes;
}
