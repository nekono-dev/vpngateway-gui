import { describe, expect, it } from "vitest";
import { resolveConnectTarget } from "./location-target.js";

const provider = (kind: "protonvpn" | "adguardvpn") => ({
  locationTarget: kind === "adguardvpn"
    ? { city: "cityName" as const, unavailableFavorite: "countryFallback" as const, fallbackProvider: "adguard" }
    : { city: "fastestServer" as const, unavailableFavorite: "error" as const, errorProvider: "proton" },
});
const dependencies = {
  locations: [
    { id: "us-chicago", country: "us", countryName: "United States", city: "Chicago", connectName: "Chicago" },
    { id: "us-united-states", country: "us", countryName: "United States", connectName: "US" },
  ],
  cities: [{ country: "us", cities: ["Chicago"] }],
  servers: [
    { name: "US-IL#834", country: "us", city: "Chicago", tier: "paid" as const, load: 10, score: 2.9 },
  ],
  favorites: [{ id: "srv-us-il-999", kind: "server" as const, country: "us", countryName: "United States", city: "Chicago", serverName: "US-IL#999" }],
};

describe("resolveConnectTarget", () => {
  it("ProtonVPNの都市を最速サーバ名へ解決する", async () => {
    await expect(resolveConnectTarget(provider("protonvpn"), "us-chicago", dependencies)).resolves.toMatchObject({ kind: "city", connectName: "US-IL#834" });
  });
  it("サーバIDを一覧上のサーバ名へ解決する", async () => {
    await expect(resolveConnectTarget(provider("protonvpn"), "srv-us-il-834", dependencies)).resolves.toMatchObject({ kind: "server", connectName: "US-IL#834" });
  });
  it("AdGuard VPNの都市は都市名を渡す", async () => {
    await expect(resolveConnectTarget(provider("adguardvpn"), "us-chicago", dependencies)).resolves.toMatchObject({ kind: "cityByName", connectName: "Chicago" });
  });
  it.each(["us-united-states", "xx-unknown"]) ("国または未知のID %s を拒否する", async (id) => {
    await expect(resolveConnectTarget(provider("protonvpn"), id, dependencies)).rejects.toThrow();
  });
  it("AdGuard VPNの一覧外お気に入りは国名fallbackとして返す", async () => {
    await expect(resolveConnectTarget(provider("adguardvpn"), "srv-us-il-999", dependencies)).resolves.toMatchObject({ kind: "countryFallback", connectName: "United States", removeFavorite: true });
  });
  it("ProtonVPNの一覧外お気に入りは保持するエラー結果として返す", async () => {
    await expect(resolveConnectTarget(provider("protonvpn"), "srv-us-il-999", dependencies)).resolves.toMatchObject({ kind: "favoriteUnavailable", error: "favorite_unavailable", removeFavorite: false });
  });
});
