// 責務: ポリシールーティング管理（policy-routing.ts）の単体テスト。ipコマンドは差し替える。

import { describe, expect, it } from "vitest";
import { hasBypassRule, parseDefaultGateway, PolicyRouting, type IpRunner } from "./policy-routing.js";

describe("parseDefaultGateway", () => {
  it("default viaのゲートウェイを取り出す", () => {
    expect(parseDefaultGateway("default via 192.168.3.1 proto dhcp src 192.168.3.240 metric 100\n")).toBe("192.168.3.1");
  });
  it("viaが無い・空はundefined", () => {
    expect(parseDefaultGateway("default dev ppp0 scope link\n")).toBeUndefined();
    expect(parseDefaultGateway("")).toBeUndefined();
  });
});

describe("hasBypassRule", () => {
  it("fwmarkとテーブルが一致する行があるときのみtrue", () => {
    expect(hasBypassRule("100:\tfrom all fwmark 0x100 lookup 100\n32766:\tfrom all lookup main\n")).toBe(true);
    expect(hasBypassRule("0:\tfrom all lookup local\n")).toBe(false);
  });
});

interface Call {
  args: string[];
  changesRouting: boolean;
}

function createRunner(state: { gateway?: string; routeTable?: string; rules?: string }) {
  const calls: Call[] = [];
  const runner: IpRunner = async (args, changesRouting) => {
    calls.push({ args: [...args], changesRouting });
    const joined = args.join(" ");
    if (joined.startsWith("-4 route show default dev")) {
      return { exitCode: 0, stdout: state.gateway ? `default via ${state.gateway} proto dhcp\n` : "" };
    }
    if (joined.startsWith("-4 route show table")) return { exitCode: 0, stdout: state.routeTable ?? "" };
    if (joined === "-4 rule show") return { exitCode: 0, stdout: state.rules ?? "" };
    return { exitCode: 0, stdout: "" };
  };
  return { runner, calls };
}

describe("PolicyRouting", () => {
  it("有効化: テーブル100の経路とfwmarkのルールを追加する", async () => {
    const { runner, calls } = createRunner({ gateway: "192.168.3.1" });
    const ok = await new PolicyRouting("eth0", runner).sync(true);
    expect(ok).toBe(true);
    const changes = calls.filter((call) => call.changesRouting).map((call) => call.args.join(" "));
    expect(changes).toEqual([
      "-4 route replace default via 192.168.3.1 dev eth0 table 100",
      "-4 rule add fwmark 0x100 table 100 priority 100",
    ]);
  });

  it("すでに整っていれば変更しない（冪等）", async () => {
    const { runner, calls } = createRunner({
      gateway: "192.168.3.1",
      routeTable: "default via 192.168.3.1 dev eth0\n",
      rules: "100:\tfrom all fwmark 0x100 lookup 100\n",
    });
    await new PolicyRouting("eth0", runner).sync(true);
    expect(calls.some((call) => call.changesRouting)).toBe(false);
  });

  it("ゲートウェイを検出できなくなっても、直近の検出結果で維持する。一度も検出できていなければ失敗（false）", async () => {
    const state: { gateway?: string } = { gateway: "192.168.3.1" };
    const { runner, calls } = createRunner(state);
    const routing = new PolicyRouting("eth0", runner);
    await routing.sync(true);
    state.gateway = undefined;
    calls.length = 0;
    expect(await routing.sync(true)).toBe(true);
    expect(calls.some((call) => call.args.join(" ").includes("via 192.168.3.1"))).toBe(true);

    const fresh = createRunner({});
    expect(await new PolicyRouting("eth0", fresh.runner).sync(true)).toBe(false);
  });

  it("無効化: 設置済みならルールを削除しテーブルを空にする。未設置なら何もしない", async () => {
    const { runner, calls } = createRunner({ gateway: "192.168.3.1" });
    const routing = new PolicyRouting("eth0", runner);
    await routing.sync(false);
    expect(calls).toEqual([]);
    await routing.sync(true);
    calls.length = 0;
    await routing.sync(false);
    expect(calls.map((call) => call.args.join(" "))).toEqual(["-4 rule del fwmark 0x100 table 100", "-4 route flush table 100"]);
  });

  it("LAN側インターフェースが未設定なら、有効化は失敗・無効化は成功として何もしない", async () => {
    const { runner, calls } = createRunner({});
    const routing = new PolicyRouting(undefined, runner);
    expect(await routing.sync(true)).toBe(false);
    expect(await routing.sync(false)).toBe(true);
    expect(calls).toEqual([]);
  });
});
