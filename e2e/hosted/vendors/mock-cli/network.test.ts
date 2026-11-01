// 責務: 経路の操作（network.ts）の単体テスト。実際の ip は呼ばず、呼び出しの記録で、退避・切り替え・復元を確かめる（要件 3.1・3.2）。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNetwork, TUNNEL_DEVICE, type RunIp } from "./network";

let dir: string;
let calls: string[][];
let runIp: RunIp;
const original = "default via 10.0.128.1 dev enp39s0 proto dhcp src 10.0.130.3 metric 100";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "network-test-"));
  calls = [];
  runIp = (args) => {
    calls.push([...args]);
    return args.includes("show") ? `${original}\n` : "";
  };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("接続・切断の経路操作", () => {
  it("接続で既定経路を退避し、vpn0 へ移す", () => {
    const network = createNetwork(join(dir, "route.txt"), runIp);
    network.connect();
    expect(calls.at(-1)).toEqual(["-4", "route", "replace", "default", "via", "10.66.0.2", "dev", TUNNEL_DEVICE]);
  });

  it("切断で退避した既定経路へ戻す", () => {
    const network = createNetwork(join(dir, "route.txt"), runIp);
    network.connect();
    network.disconnect();
    expect(calls.at(-1)).toEqual(["-4", "route", "replace", "default", "via", "10.0.128.1", "dev", "enp39s0", "proto", "dhcp", "src", "10.0.130.3", "metric", "100"]);
  });

  it("接続を二重に呼んでも、既定経路を再度退避しない（冪等）", () => {
    const network = createNetwork(join(dir, "route.txt"), runIp);
    network.connect();
    const before = calls.length;
    network.connect();
    expect(calls.length).toBe(before);
  });

  it("接続していない状態の切断は何もしない", () => {
    const network = createNetwork(join(dir, "route.txt"), runIp);
    network.disconnect();
    expect(calls).toEqual([]);
  });
});
