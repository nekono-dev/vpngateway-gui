// 責務: 段の選び方の宣言（hopSelection）が、ベンダーのプロファイルで読め、不正な宣言を拒否することを確かめる。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { HopSelectionSchema, VendorProfileSchema } from "./profile.schema.js";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

function loadVendorProfile(vendorId: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, "vendors", vendorId, "profile.json"), "utf8"));
}

describe("HopSelectionSchema", () => {
  it("接続先一覧の列（ping）を最小化する宣言を通す", () => {
    expect(Value.Check(HopSelectionSchema, { source: "listLocations", value: "ping", direction: "min" })).toBe(true);
  });

  it("キャッシュファイルの値（Score）を最小化する宣言を通す", () => {
    const decl = {
      source: "cacheFile",
      value: "Score",
      direction: "min",
      file: "VPN/serverlist.json",
      list: "LogicalServers",
      country: "ExitCountry",
      city: "City",
    };
    expect(Value.Check(HopSelectionSchema, decl)).toBe(true);
  });

  it("最大化など、対象外の向きを拒否する", () => {
    expect(Value.Check(HopSelectionSchema, { source: "listLocations", value: "ping", direction: "max" })).toBe(false);
  });

  it("キャッシュファイルの宣言に、ファイル名が無ければ拒否する", () => {
    expect(Value.Check(HopSelectionSchema, { source: "cacheFile", value: "Score", direction: "min" })).toBe(false);
  });
});

describe("ベンダーの宣言", () => {
  it("AdGuard VPN は ping の最小を宣言する", () => {
    const profile = loadVendorProfile("adguardvpn");
    expect(Value.Check(VendorProfileSchema, profile)).toBe(true);
    expect((profile as { hopSelection?: unknown }).hopSelection).toEqual({
      source: "listLocations",
      value: "ping",
      direction: "min",
    });
  });

  it("ProtonVPN は CLI のキャッシュ（VPN/serverlist.json）の Score の最小を宣言する", () => {
    const profile = loadVendorProfile("protonvpn");
    expect(Value.Check(VendorProfileSchema, profile)).toBe(true);
    const selection = (profile as { hopSelection?: { source: string; value: string; file: string } }).hopSelection;
    expect(selection?.source).toBe("cacheFile");
    expect(selection?.value).toBe("Score");
    expect(selection?.file).toBe("VPN/serverlist.json");
  });
});
