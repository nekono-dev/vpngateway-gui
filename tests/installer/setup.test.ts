// 責務: 本体インストーラ（`installer/setup.sh`）の引数・設定・ホスト変更・自動検査の受け入れテスト。
// 受け入れ条件 installer/AC-1〜AC-4・AC-9・AC-10・AC-12・AC-13・AC-15〜AC-17 を確認する。
// 実際の導入（apt・Docker・起動）は行わず、関数だけを偽のリポジトリで実行する。

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakeRepo, runSetupLib } from "../helpers/installer.js";
import { readRepoFile, repoPath } from "../helpers/repo.js";

const setupSource = readRepoFile("installer/setup.sh");

/** 目的: シェル関数の本体（`name() {` から次の行頭の `}` まで）を取り出す。 */
function functionBody(source: string, name: string): string {
  const match = new RegExp(`^${name}\\(\\) \\{\\n([\\s\\S]*?)\\n\\}`, "m").exec(source);
  if (match?.[1] === undefined) throw new Error(`function not found: ${name}`);
  return match[1];
}

describe("本体インストーラ", () => {
  it("installer/AC-1: 起点が事前検査・依存導入・設定・起動の各工程をこの順に呼び、構文が正しい", () => {
    expect(spawnSync("sh", ["-n", repoPath("installer/setup.sh")]).status).toBe(0);
    const body = functionBody(setupSource, "install_roles");
    const order = ["preflight", "install_packages", "install_docker", "env_set COMPOSE_FILE", "run_host_hooks", "start_stack"];
    const positions = order.map((step) => body.indexOf(step));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // 引数の解釈から起点（導入・限定導入・アンインストール）への分岐がある。
    const main = functionBody(setupSource, "main");
    expect(main).toContain("orchestrate_main");
    expect(main).toContain("uninstall_main");
  });

  it("installer/AC-2: ベンダーを指定しないと全バンドルが有効になり、指定すると指定した集合だけが有効になる", () => {
    const repo = makeFakeRepo({ vendors: ["vendora", "vendorb"], incompleteVendors: ["nocompose"] });
    const all = runSetupLib(repo, "PROVIDERS_ARG=''; determine_providers >/dev/null; printf '%s' \"$PROVIDERS\"");
    expect(all.stdout).toBe("vendora,vendorb");
    // 既存の設定に一部のベンダーだけが書かれていても、省略時は全バンドルになる。
    writeFileSync(join(repo, ".env"), "VPN_PROVIDERS=vendora\n");
    expect(runSetupLib(repo, "PROVIDERS_ARG=''; determine_providers >/dev/null; printf '%s' \"$PROVIDERS\"").stdout).toBe("vendora,vendorb");
    const picked = runSetupLib(repo, "PROVIDERS_ARG='vendorb'; determine_providers >/dev/null; printf '%s' \"$PROVIDERS\"");
    expect(picked.stdout).toBe("vendorb");
    // バンドルの無いベンダーの指定は拒否される。
    expect(runSetupLib(repo, "PROVIDERS_ARG='unknown'; determine_providers >/dev/null 2>&1").status).not.toBe(0);
  });

  it("installer/AC-3: ポートを省略すると既存の設定値、設定が無ければ443になり、範囲外の値は拒否される", () => {
    const repo = makeFakeRepo();
    const port = (arg: string) => runSetupLib(repo, `WEB_PORT_ARG='${arg}'; setup_web_port >/dev/null; printf '%s' "$WEB_PORT"`);
    expect(port("").stdout).toBe("443");
    expect(port("8080").stdout).toBe("8080");
    writeFileSync(join(repo, ".env"), "WEB_PORT=8443\n");
    expect(port("").stdout).toBe("8443");
    for (const invalid of ["0", "65536", "abc", "-1"]) {
      expect(port(invalid).status, invalid).not.toBe(0);
    }
  });

  it("installer/AC-4: 設定の更新は他の行を保持し、同じ値での更新を繰り返しても内容が変わらない", () => {
    const repo = makeFakeRepo();
    writeFileSync(join(repo, ".env"), "KEEP_ME=1\nTARGET=old\nOTHER=2\n");
    runSetupLib(repo, "env_set TARGET new");
    const first = readFileSync(join(repo, ".env"), "utf8");
    expect(first.split("\n").filter(Boolean).sort()).toEqual(["KEEP_ME=1", "OTHER=2", "TARGET=new"]);
    runSetupLib(repo, "env_set TARGET new");
    expect(readFileSync(join(repo, ".env"), "utf8")).toBe(first);
  });

  it("installer/AC-9: 書き込むホスト上のパスが定義されたものに限られ、アンインストールが全てを撤去する", () => {
    // 先頭の変数定義のうち、絶対パスを持つものがホスト上の変更先である。
    const header = setupSource.slice(0, setupSource.indexOf("\nlog() "));
    const hostPaths = [...header.matchAll(/^([A-Z_]+)="(\/[^"]*)"$/gm)].map((match) => match[1]);
    expect(hostPaths.sort()).toEqual(
      ["GUARD_UNIT", "HOST_CTL_DIR", "PKI_DIR", "REBOOT_PATH_UNIT", "REBOOT_SERVICE_UNIT", "SYSCTL_FILE"].sort(),
    );
    // それぞれを、アンインストールの関数が参照して撤去する。
    const removers: Record<string, string> = {
      SYSCTL_FILE: "uninstall_sysctl",
      GUARD_UNIT: "uninstall_boot_guard",
      HOST_CTL_DIR: "uninstall_host_reboot",
      REBOOT_PATH_UNIT: "uninstall_host_reboot",
      REBOOT_SERVICE_UNIT: "uninstall_host_reboot",
      PKI_DIR: "uninstall_gateway_pki",
    };
    for (const [variable, remover] of Object.entries(removers)) {
      expect(functionBody(setupSource, remover), variable).toContain(`$${variable}`);
    }
  });

  it("installer/AC-10: アンインストールは配置先の指定と併用できず、データ保持の指定はアンインストール以外では拒否される", () => {
    const run = (...args: string[]) => spawnSync("sh", [repoPath("installer/setup.sh"), ...args], { encoding: "utf8" });
    const withTarget = run("--uninstall", "--api", "host.example");
    expect(withTarget.status).not.toBe(0);
    expect(withTarget.stderr).toContain("併用できません");
    const keepOnly = run("--keep-data");
    expect(keepOnly.status).not.toBe(0);
    expect(keepOnly.stderr).toContain("--keep-data は --uninstall と併用してください");
  });

  it("installer/AC-12: ベンダーのホスト側の手順は、存在するバンドルについてだけ、そのバンドルの場所で実行される", () => {
    const marker = join(mkdtempSync(join(tmpdir(), "vpngwgui-accept-hook-")), "marker");
    const repo = makeFakeRepo({
      vendors: ["vendora", "vendorb"],
      hostHooks: { vendora: `#!/bin/sh\nprintf '%s|%s|%s' "$PWD" "$VPNGW_VENDOR_ID" "$VPNGW_ROOT" > ${marker}\n` },
    });
    // vendorb は手順を持たないが、失敗せずに続行する。
    const ok = runSetupLib(repo, "PROVIDER_IDS='vendora vendorb'; run_host_hooks >/dev/null");
    expect(ok.status).toBe(0);
    const realRepo = repo.replace(/\/$/, "");
    expect(readFileSync(marker, "utf8")).toContain(`vendors/vendora|vendora|`);
    expect(readFileSync(marker, "utf8").endsWith(realRepo)).toBe(true);
    // 非ゼロ終了の手順は導入を中止する。
    const failing = makeFakeRepo({ vendors: ["vendora"], hostHooks: { vendora: "#!/bin/sh\nexit 3\n" } });
    expect(runSetupLib(failing, "PROVIDER_IDS='vendora'; run_host_hooks >/dev/null 2>&1").status).not.toBe(0);
  });

  it("installer/AC-13: 同じ引数でポートとベンダーを決定して設定を2回書いても、設定ファイルの内容が変わらない", () => {
    const repo = makeFakeRepo();
    const write = `PROVIDERS_ARG=''; WEB_PORT_ARG='8443'; setup_web_port >/dev/null; determine_providers >/dev/null; env_set VPN_PROVIDERS "$PROVIDERS"`;
    runSetupLib(repo, write);
    const first = readFileSync(join(repo, ".env"), "utf8");
    runSetupLib(repo, write);
    expect(readFileSync(join(repo, ".env"), "utf8")).toBe(first);
    expect(first).toContain("VPN_PROVIDERS=vendora,vendorb");
  });

  it("installer/AC-15: Web UIの起動確認の待機は、180秒を上限とする", () => {
    const body = functionBody(setupSource, "start_stack");
    const limit = /\[ "\$waited" -lt (\d+) \]/.exec(body);
    expect(limit?.[1]).toBe("180");
    // 待機間隔は3秒で、加算する秒数と一致する。
    expect(body).toContain("sleep 3");
    expect(body).toContain("waited=$((waited + 3))");
  });

  it("installer/AC-16: 範囲外のポートと不正なベンダーIDを含む設定は、検査で拒否される", () => {
    const repo = makeFakeRepo();
    const dir = mkdtempSync(join(tmpdir(), "vpngwgui-accept-appcheck-"));
    /** 目的: 設定値を与えて app_check を実行する。 */
    const check = (config: Record<string, string>) => {
      const stub = [
        "die() { echo \"エラー: $*\" >&2; exit 1; }",
        `DIR='${repo}'`,
        `config_value() { case "$1" in ${Object.entries(config)
          .map(([key, value]) => `${key}) printf '%s' '${value}' ;;`)
          .join(" ")} *) printf '' ;; esac; }`,
        `. '${repoPath("installer/app.sh")}'`,
        "app_check",
      ].join("\n");
      writeFileSync(join(dir, "check.sh"), stub);
      return spawnSync("sh", [join(dir, "check.sh")], { encoding: "utf8" });
    };
    expect(check({ PROVIDERS: "vendora", WEB_PORT: "8443" }).status).toBe(0);
    expect(check({ WEB_PORT: "70000" }).status).not.toBe(0);
    expect(check({ WEB_PORT: "0" }).status).not.toBe(0);
    expect(check({ PROVIDERS: "Bad" }).status).not.toBe(0);
    expect(check({ PROVIDERS: "a".repeat(33) }).status).not.toBe(0);
    expect(check({ PROVIDERS: "missing" }).status).not.toBe(0);
  });

  it("installer/AC-17: 同梱の自動検査を一般ユーザーで実行すると、失敗が0件で終了する", () => {
    expect(process.getuid?.()).not.toBe(0);
    const result = spawnSync("sh", [repoPath("installer/tests/run.sh")], { encoding: "utf8" });
    expect(result.stdout).toContain("FAIL 0 件");
    expect(result.stdout).not.toMatch(/^FAIL:/m);
    expect(result.status).toBe(0);
    expect(existsSync(repoPath("installer/tests/run.sh"))).toBe(true);
  });
});
