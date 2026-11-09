import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCityList } from "../../../api/src/locations/city-list-parser.js";

const cli = new URL("./protonvpn-mock.mjs", import.meta.url);

describe("mockproton CLI", () => {
  function createRunner() {
    const dir = mkdtempSync(join(tmpdir(), "mockproton-test-"));
    const env = {
      ...process.env,
      MOCK_STATE_FILE: join(dir, "state.json"),
      PROVIDER_CACHE_DIR: join(dir, "cache"),
    };
    const run = (args: string[], input = "") => spawnSync(process.execPath, [cli.pathname, ...args], { encoding: "utf8", input, env, timeout: 10000 });
    return { dir, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  it("都市一覧を実 CLI 形式で出し、都市名を解析できる", () => {
    const runner = createRunner();
    try {
      const result = runner.run(["cities", "list", "--country", "jp"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^\nCities in Japan:\nCity\s+Features\n-+\s+-+\n(?:.+\n){2,3}\n$/);
      expect(parseCityList(result.stdout, { city: "City", features: "Features" })).not.toHaveLength(0);
    } finally { runner.cleanup(); }
  });

  it("無効な国コードを終了コード1で拒否する", () => {
    const runner = createRunner();
    try {
      const result = runner.run(["cities", "list", "--country", "ZZ"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error: Invalid country code");
    } finally { runner.cleanup(); }
  });

  it("signin 時に宣言された形式のサーバカタログを書く", () => {
    const runner = createRunner();
    try {
      expect(runner.run(["signin", "paid@example.com"], "mock-pass\n").status).toBe(0);
      const catalogPath = join(runner.dir, "cache", "mockproton", "VPN", "serverlist.json");
      const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as { LogicalServers: Record<string, unknown>[] };
      expect(catalog.LogicalServers.length).toBeGreaterThan(0);
      expect(catalog.LogicalServers.filter((server) => server.Tier === 0)).toHaveLength(1);
      expect(new Set(catalog.LogicalServers.map((server) => server.ExitCountry))).toEqual(new Set(["AU", "CH", "JP", "US"]));
      for (const server of catalog.LogicalServers) {
        expect(server.Name).toEqual(expect.any(String));
        expect(server.ExitCountry).toMatch(/^[A-Z]{2}$/);
        expect(server.City).toEqual(expect.any(String));
        expect([0, 2]).toContain(server.Tier);
        expect([0, 1, 2, 4, 3, 5, 6, 7]).toContain(server.Features);
        expect(server.Status).toBe(true);
        expect(server.Score).toEqual(expect.any(Number));
        expect(server.Load).toEqual(expect.any(Number));
        expect(server.Load).toBeGreaterThanOrEqual(0);
        expect(server.Load).toBeLessThanOrEqual(100);
      }
    } finally { runner.cleanup(); }
  });

  it("サーバ名で接続し、存在しない名前は usage error にする", () => {
    const runner = createRunner();
    try {
      expect(runner.run(["signin", "paid@example.com"], "mock-pass\n").status).toBe(0);
      expect(runner.run(["connect", "JP-TK#1"]).status).toBe(0);
      expect(runner.run(["status"]).stdout).toContain("JP-TK#1 in Tokyo, Japan");
      const missing = runner.run(["connect", "NO-SUCH#1"]);
      expect(missing.status).toBe(2);
      expect(missing.stderr).toContain("Error: Invalid server name 'NO-SUCH#1'.");
    } finally { runner.cleanup(); }
  });

  it("有料アカウントの国指定の接続・接続後の status・signout を保つ", () => {
    const runner = createRunner();
    try {
      expect(runner.run(["signin", "paid@example.com"], "mock-pass\n").status).toBe(0);
      const connected = runner.run(["connect", "--country", "JP"]);
      expect(connected.status).toBe(0);
      expect(connected.stdout).toContain("Connected to JP#12 in Tokyo, Japan.");
      expect(runner.run(["status"]).stdout).toBe("Status: Connected\nServer: JP#12 in Tokyo, Japan\nLoad: 41%\nProtocol: wireguard-udp\n");
      const byCode = runner.run(["connect", "JP"]);
      expect(byCode.status).toBe(0);
      expect(byCode.stdout).toContain("Connected to JP#12 in Tokyo, Japan.");
      expect(runner.run(["status"]).stdout).toContain("Server: JP#12 in Tokyo, Japan");
      const invalid = runner.run(["connect", "--country", "ZZ"]);
      expect(invalid.status).toBe(2);
      expect(invalid.stderr).toContain("Invalid country code 'ZZ'");
      const signedOut = runner.run(["signout"]);
      expect(signedOut.status).toBe(0);
      expect(signedOut.stdout).toContain("VPN connection terminated and you've been successfully signed out.");
      expect(runner.run(["status"]).stdout).toBe("Status: Disconnected\n");
    } finally { runner.cleanup(); }
  });

  it("無料アカウントの指定接続制限と2FAを保つ", () => {
    const runner = createRunner();
    try {
      expect(runner.run(["status"]).stdout).toBe("Status: Disconnected\n");
      expect(runner.run(["signin", "free@example.com"], "mock-pass\n").status).toBe(0);
      expect(runner.run(["connect", "JP-TK#1"]).status).toBe(2);
      expect(runner.run(["connect", "--country", "JP"]).status).toBe(2);
      expect(runner.run(["connect"]).stdout).toContain("Connected to JP-FREE#5 in Tokyo, Japan.");
    } finally { runner.cleanup(); }
    const twoFactorRunner = createRunner();
    try {
      const twoFactor = twoFactorRunner.run(["signin", "free2fa@example.com"], "mock-pass\n");
      expect(twoFactor.status).toBe(1);
      expect(twoFactor.stderr).toContain("Aborted!");
    } finally { twoFactorRunner.cleanup(); }
  });
});
