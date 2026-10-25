// 責務: ロールの配置先（トポロジー）の決定・照合・到達性検査の受け入れテスト。
// 受け入れ条件 installer/AC-5〜AC-7 を、偽のリポジトリで関数を実行して確認する。

import { describe, expect, it } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFakeRepo, runSetupLib } from "../helpers/installer.js";

/** 目的: 引数を与えて determine_topology を実行し、ロールごとの配置先を `web|api|gateway` の形で返す。 */
function topology(repo: string, args: { web?: string; api?: string; gateway?: string }) {
  const script = [
    `WEB_HOST_ARG='${args.web ?? ""}'`,
    `API_HOST_ARG='${args.api ?? ""}'`,
    `GATEWAY_HOST_ARG='${args.gateway ?? ""}'`,
    "determine_topology >/dev/null",
    'printf "%s|%s|%s" "$ROLE_HOST_web" "$ROLE_HOST_api" "$ROLE_HOST_gateway"',
  ].join("; ");
  return runSetupLib(repo, script);
}

describe("ロールの配置", () => {
  it("installer/AC-5: 配置先を指定しないロールはローカルに、指定したロールはそのホストに決まる", () => {
    const repo = makeFakeRepo();
    expect(topology(repo, {}).stdout).toBe("||");
    expect(topology(repo, { gateway: "gw.example" }).stdout).toBe("||gw.example");
    expect(topology(repo, { web: "w.example", api: "a.example", gateway: "g.example" }).stdout).toBe("w.example|a.example|g.example");
    // リモートホストは gateway → api → web の順に、重複を除いて処理する。
    const order = runSetupLib(
      repo,
      "ROLE_HOST_web=h1; ROLE_HOST_api=h2; ROLE_HOST_gateway=h1; distinct_remote_hosts | tr '\\n' ' '; roles_assigned_to_host h1",
    );
    expect(order.stdout).toBe("h1 h2 web,gateway");
  });

  it("installer/AC-6: 到達できないホストを指定すると、設定ファイルを書く前に停止する", () => {
    const repo = makeFakeRepo();
    const result = runSetupLib(repo, "GATEWAY_HOST_ARG='no-such-host.invalid'; orchestrate_main", { SUDO_USER: "" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SSH到達性");
    // 証明書の生成・トポロジーの記録・composeの設定の、いずれも行われていない。
    expect(existsSync(join(repo, ".env"))).toBe(false);
  });

  it("installer/AC-7: 記録済みと異なる配置先の指定は、停止して理由を示す", () => {
    const repo = makeFakeRepo();
    writeFileSync(join(repo, ".env"), "TOPOLOGY_RECORDED=1\nTOPOLOGY_WEB_HOST=\nTOPOLOGY_API_HOST=a.example\nTOPOLOGY_GATEWAY_HOST=\n");
    const mismatch = topology(repo, { api: "b.example" });
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain("配置トポロジーが記録済みの構成と異なります");
    expect(mismatch.stderr).toContain("api=a.example");
    // 省略（ローカルへ戻す）も記録と異なる指定として拒否される。
    expect(topology(repo, {}).status).not.toBe(0);
    // 同じ指定は受理される。
    expect(topology(repo, { api: "a.example" }).stdout).toBe("|a.example|");
  });
});
