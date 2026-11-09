// 責務: モック CLI の単体テスト。出力が samples.json のケースと一致すること（ケース名で突き合わせる）と、経路の操作の呼び出しを確かめる（要件 3.1〜3.7・4.1）。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// サインインはカタログを既定のキャッシュ先へ書くため、テストでは一時ディレクトリへ向ける（既定の場所は実行環境の権限に依る）。
process.env.MOCKVPN_CACHE_DIR ??= mkdtempSync(join(tmpdir(), "mockvpn-test-cache-"));
import { MOCK_ACCOUNT, runCommand, sampleOutput, vendorFromBinary, type MockState, type Network } from "./mockvpn";

/** 経路の操作の記録（実際のネットワークは変更しない）。 */
function recorder(): Network & { calls: string[] } {
  const calls: string[] = [];
  return { calls, connect: () => calls.push("connect"), disconnect: () => calls.push("disconnect") };
}

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

describe("呼び出し名からベンダーを決める", () => {
  it("両ベンダーの呼び出し名を解決し、未知の名前は拒否する", () => {
    expect(vendorFromBinary("/usr/bin/protonvpn")).toBe("protonvpn");
    expect(vendorFromBinary("/usr/local/bin/adguardvpn-cli")).toBe("adguardvpn");
    expect(() => vendorFromBinary("/usr/bin/curl")).toThrow("知らない呼び出し名");
  });
});

describe("samples.json のケースとの一致", () => {
  it("Proton: 切断中・接続中の status が、サンプルの stdout と一致する", () => {
    const disconnected: MockState = { loggedIn: true, plan: "free", connected: false };
    expect(runCommand("protonvpn", ["status"], disconnected, recorder()).stdout).toBe(
      sampleOutput("protonvpn", "status: 切断中（未ログインでも同じ）"),
    );
    const connected: MockState = { loggedIn: true, plan: "free", connected: true, location: "JP-FREE#3 in Osaka, Japan" };
    expect(runCommand("protonvpn", ["status"], connected, recorder()).stdout).toBe(sampleOutput("protonvpn", "status: 接続中"));
  });

  it("Proton: 無料版・有料版・未ログインの config list が、サンプルと一致する（未ログインは終了コード 2）", () => {
    const free = runCommand("protonvpn", ["config", "list"], { loggedIn: true, plan: "free", connected: false }, recorder());
    expect(free.stdout).toBe(sampleOutput("protonvpn", "account: 無料版"));
    const paid = runCommand("protonvpn", ["config", "list"], { loggedIn: true, plan: "paid", connected: false }, recorder());
    expect(paid.stdout).toBe(sampleOutput("protonvpn", "account: 有料版（無料版の文言が無い）"));
    const out = runCommand("protonvpn", ["config", "list"], { loggedIn: false, plan: "unknown", connected: false }, recorder());
    expect(out.exitCode).toBe(2);
    expect(out.stdout).toBe(sampleOutput("protonvpn", "account: 未ログイン（非ゼロ終了でも未ログインと判定）"));
  });

  it("AdGuard: 接続中・切断中の status が、ANSI を除いたサンプルと一致する", () => {
    const connected: MockState = { loggedIn: true, plan: "premium", connected: true, location: "TOKYO" };
    expect(runCommand("adguardvpn", ["status"], connected, recorder()).stdout).toBe(
      stripAnsi(sampleOutput("adguardvpn", "status: 接続中（ANSI付き・接続先の都市名）")),
    );
    const disconnected: MockState = { loggedIn: true, plan: "premium", connected: false };
    expect(runCommand("adguardvpn", ["status"], disconnected, recorder()).stdout).toBe(sampleOutput("adguardvpn", "status: 切断中"));
  });

  it("AdGuard: 有料版・無料版・未ログインの license が、サンプルと一致する", () => {
    const premium = runCommand("adguardvpn", ["license"], { loggedIn: true, plan: "premium", connected: false }, recorder());
    expect(premium.stdout).toBe(sampleOutput("adguardvpn", "account: 有料版"));
    const free = runCommand("adguardvpn", ["license"], { loggedIn: true, plan: "free", connected: false }, recorder());
    expect(free.stdout).toBe(sampleOutput("adguardvpn", "account: 無料版（残りデータ通信量の補足情報）"));
    const out = runCommand("adguardvpn", ["license"], { loggedIn: false, plan: "unknown", connected: false }, recorder());
    expect(out.exitCode).toBe(11);
  });
});

describe("接続・切断と経路の操作", () => {
  it("Proton: 接続で経路を移し、切断で元に戻す（経路の操作を 1 回ずつ呼ぶ）", () => {
    const network = recorder();
    const state: MockState = { loggedIn: true, plan: "free", connected: false };
    runCommand("protonvpn", ["connect", "--country", "jp"], state, network);
    runCommand("protonvpn", ["disconnect"], state, network);
    expect(network.calls).toEqual(["connect", "disconnect"]);
    expect(state.connected).toBe(false);
  });

  it("未ログインでの接続は失敗し、経路を変えない", () => {
    const network = recorder();
    const out = runCommand("adguardvpn", ["connect", "-l", "tokyo", "-y"], { loggedIn: false, plan: "unknown", connected: false }, network);
    expect(out.exitCode).toBe(1);
    expect(network.calls).toEqual([]);
  });

  it("Proton: signin はパスワードを stdin の 1 行目から受け取り、空なら失敗する", () => {
    const state: MockState = { loggedIn: false, plan: "unknown", connected: false };
    expect(runCommand("protonvpn", ["signin", "--totp", "user"], state, recorder(), [""]).exitCode).toBe(1);
    expect(runCommand("protonvpn", ["signin", "--totp", "user"], state, recorder(), ["pw", "123456"]).exitCode).toBe(1);
    expect(state.loggedIn).toBe(false);
  });

  it("Proton: signin は試験の認証情報のみ受け付け、誤りは失敗にする", () => {
    const state: MockState = { loggedIn: false, plan: "unknown", connected: false };
    const ok = [MOCK_ACCOUNT.password, MOCK_ACCOUNT.totp];
    expect(runCommand("protonvpn", ["signin", "--totp", MOCK_ACCOUNT.user], state, recorder(), ok).exitCode).toBe(0);
    expect(state.loggedIn).toBe(true);
    const wrong = { loggedIn: false, plan: "unknown", connected: false } as MockState;
    expect(runCommand("protonvpn", ["signin", "--totp", MOCK_ACCOUNT.user], wrong, recorder(), ["wrong", MOCK_ACCOUNT.totp]).exitCode).toBe(1);
    expect(runCommand("protonvpn", ["signin", "--totp", "other@example.test"], wrong, recorder(), ok).exitCode).toBe(1);
    expect(runCommand("protonvpn", ["signin", "--totp", MOCK_ACCOUNT.user], wrong, recorder(), [MOCK_ACCOUNT.password, "000000"]).exitCode).toBe(1);
    expect(wrong.loggedIn).toBe(false);
  });

  it("未対応のコマンドは終了コード 2 で返す（黙って成功させない）", () => {
    expect(runCommand("protonvpn", ["unknown"], { loggedIn: false, plan: "unknown", connected: false }, recorder()).exitCode).toBe(2);
  });

  it("切断の失敗の制御を与えると、切断は失敗し、経路を変えず接続も残る（要件 4.9 の模擬）", () => {
    const network = recorder();
    const state: MockState = { loggedIn: true, plan: "free", connected: true, location: "JP" };
    const out = runCommand("protonvpn", ["disconnect"], state, network, [], { disconnectFails: true });
    expect(out.exitCode).toBe(1);
    expect(network.calls).toEqual([]);
    expect(state.connected).toBe(true);
  });

  it("ログインの失敗の制御を与えると、signin は失敗し、ログイン状態は変わらない（要件 3.7 の模擬）", () => {
    const state: MockState = { loggedIn: false, plan: "unknown", connected: false };
    const out = runCommand("protonvpn", ["signin", "--totp", "user"], state, recorder(), ["pw"], { loginFails: true });
    expect(out.exitCode).toBe(1);
    expect(state.loggedIn).toBe(false);
  });
});

describe("ProtonVPN の都市一覧・サーバカタログ・サーバ名での接続", () => {
  it("都市一覧は実 CLI の形式で、api の解析規則で都市名を取り出せる", async () => {
    const { parseCityList } = await import("../../../../api/src/locations/city-list-parser.js");
    const { protonCitiesOutput } = await import("./mockvpn");
    const output = protonCitiesOutput("JP") ?? "";
    expect(output).toMatch(/^\nCities in Japan:\nCity\s+Features\n-+\s+-+\n/);
    expect(parseCityList(output, { city: "City" })).toEqual(["Tokyo", "Osaka"]);
    expect(protonCitiesOutput("ZZ")).toBeUndefined();
  });

  it("cities list の未知の国コードは終了コード 1 で拒否する", () => {
    const result = runCommand("protonvpn", ["cities", "list", "--country", "ZZ"], { loggedIn: false, plan: "unknown", connected: false }, recorder());
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Invalid country code");
  });

  it("サインインでカタログを書き、サーバ名で接続できる（存在しない名前は拒否）", async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "mockvpn-cache-"));
    const previous = process.env.MOCKVPN_CACHE_DIR;
    process.env.MOCKVPN_CACHE_DIR = dir;
    try {
      const state: MockState = { loggedIn: false, plan: "unknown", connected: false };
      const signedIn = runCommand("protonvpn", ["signin", MOCK_ACCOUNT.user], state, recorder(), [MOCK_ACCOUNT.password, MOCK_ACCOUNT.totp]);
      expect(signedIn.exitCode).toBe(0);
      const catalog = JSON.parse(readFileSync(join(dir, "VPN", "serverlist.json"), "utf8")) as { LogicalServers: { Name: string; Features: number; Status: boolean }[] };
      expect(catalog.LogicalServers.find((item) => item.Name === "JP-TK#1")?.Status).toBe(true);
      expect(state.plan).toBe("paid");
      const net = recorder();
      const connected = runCommand("protonvpn", ["connect", "JP-TK#1"], state, net);
      expect(connected.exitCode).toBe(0);
      expect(connected.stdout).toContain("Connected to JP-TK#1 in Tokyo, Japan.");
      expect(state.location).toBe("JP-TK#1 in Tokyo, Japan");
      expect(net.calls).toEqual(["connect"]);
      const missing = runCommand("protonvpn", ["connect", "NO-SUCH#1"], state, recorder());
      expect(missing.exitCode).toBe(2);
      expect(missing.stdout).toContain("Invalid server name 'NO-SUCH#1'");
    } finally {
      if (previous === undefined) delete process.env.MOCKVPN_CACHE_DIR; else process.env.MOCKVPN_CACHE_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
