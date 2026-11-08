import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fastestServer, readCatalog, serversInCity } from "./server-catalog.js";
import type { ServerCatalog } from "../profile/profile.schema.js";

const def: ServerCatalog = { file: "serverlist.json", list: "LogicalServers", name: "Name", country: "ExitCountry", city: "City", tier: "Tier", features: "Features", status: "Status", score: "Score", load: "Load" };
const dir = mkdtempSync(join(tmpdir(), "server-catalog-"));
const cacheRoot = join(dir, "cache");
process.env.PROVIDER_CACHE_DIR = cacheRoot;
afterEach(() => rmSync(join(cacheRoot, "protonvpn"), { recursive: true, force: true }));

function writeServers(servers: unknown[], file = def.file): void {
  const providerDir = join(cacheRoot, "protonvpn");
  mkdirSync(providerDir, { recursive: true });
  writeFileSync(join(providerDir, file), JSON.stringify({ LogicalServers: servers }));
}

function server(name: string, score: number, fields: Record<string, unknown> = {}) {
  return { Name: name, ExitCountry: "US", City: "Chicago", Tier: 0, Features: 0, Status: true, Score: score, Load: 10, ...fields };
}

describe("Server catalog", () => {
  it("有効な非 Secure Core だけをScore順、同値は名前順に返し、Tier 0を無料とする", () => {
    writeServers([server("US-IL#z", 10), server("US-IL#b", 5), server("US-IL#a", 5), server("US-IL#sc", 1, { Features: 1 }), server("US-IL#off", 0, { Status: false }), server("NY#1", 1, { City: "New York" })]);
    expect(serversInCity("protonvpn", def, "us", "Chicago")).toEqual([
      { name: "US-IL#a", country: "us", city: "Chicago", tier: "free", load: 10, score: 5 },
      { name: "US-IL#b", country: "us", city: "Chicago", tier: "free", load: 10, score: 5 },
      { name: "US-IL#z", country: "us", city: "Chicago", tier: "free", load: 10, score: 10 },
    ]);
  });

  it("最速を選び、Tier 0以外を有料とする", () => {
    writeServers([server("US-IL#378", 2.9965605212439517, { Tier: 2, Features: 28, Load: 50 }), server("US-IL#834", 2.9877, { Tier: 2, Features: 28 }), server("US-IL#200", 3, { Tier: 1 })]);
    expect(fastestServer("protonvpn", def, "US", "Chicago")).toEqual({ name: "US-IL#834", country: "us", city: "Chicago", tier: "paid", load: 10, score: 2.9877 });
    expect(serversInCity("protonvpn", def, "US", "Chicago")[1].tier).toBe("paid");
  });

  it("キャッシュを読めない場合は例外にする", () => {
    expect(() => readCatalog("protonvpn", def)).toThrow();
  });

  it("数値1のStatusも有効として扱う", () => {
    writeServers([server("US-IL#numeric", 1, { Status: 1 })]);
    expect(serversInCity("protonvpn", def, "US", "Chicago")).toHaveLength(1);
  });

  it("キャッシュ外を指すシンボリックリンクを拒否する", () => {
    const providerDir = join(cacheRoot, "protonvpn");
    mkdirSync(providerDir, { recursive: true });
    const outside = join(dir, "outside.json");
    writeFileSync(outside, JSON.stringify({ LogicalServers: [] }));
    symlinkSync(outside, join(providerDir, "linked.json"));
    expect(() => readCatalog("protonvpn", { ...def, file: "linked.json" })).toThrow(/outside provider cache/);
  });
});
