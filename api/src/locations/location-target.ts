// 責務: 永続化された接続先IDを、プロバイダーの接続アクションへ渡す名前に解決する。

import { toServerLocationId } from "./location-id.js";

export interface ConnectLocation {
  readonly id: string;
  readonly country: string;
  readonly countryName: string;
  readonly city?: string;
  readonly connectName: string;
}

export interface ConnectServer {
  readonly name: string;
  readonly country: string;
  readonly city: string;
  readonly tier: "free" | "paid";
  readonly load: number;
  readonly score: number;
}

export interface ConnectFavorite {
  readonly id: string;
  readonly kind: "city" | "server";
  readonly country: string;
  readonly countryName: string;
  readonly city: string;
  readonly serverName?: string;
}

export type ConnectTarget =
  | { readonly kind: "city"; readonly locationId: string; readonly country: string; readonly connectName: string }
  | { readonly kind: "server"; readonly locationId: string; readonly country: string; readonly connectName: string }
  | { readonly kind: "cityByName"; readonly locationId: string; readonly country: string; readonly connectName: string }
  | { readonly kind: "countryFallback"; readonly provider: string; readonly locationId: string; readonly country: string; readonly connectName: string; readonly removeFavorite: true }
  | { readonly kind: "favoriteUnavailable"; readonly provider: string; readonly locationId: string; readonly error: "favorite_unavailable"; readonly removeFavorite: false };

export interface ConnectTargetDependencies {
  readonly locations: readonly ConnectLocation[];
  readonly cities: readonly { readonly country: string; readonly cities: readonly string[] }[];
  readonly servers: readonly ConnectServer[];
  readonly favorites: readonly ConnectFavorite[];
}

export class UnknownConnectTargetError extends Error {
  constructor(locationId: string) {
    super(`unknown locationId: ${locationId}`);
    this.name = "UnknownConnectTargetError";
  }
}

/** IDの種別を判定し、都市・サーバ名へ解決する。国の行は接続先として拒否する。 */
export async function resolveConnectTarget(
  provider: { readonly locationTarget?: { readonly city: "fastestServer" | "cityName"; readonly unavailableFavorite: "countryFallback" | "error"; readonly fallbackProvider?: string; readonly errorProvider?: string } },
  locationId: string,
  dependencies: ConnectTargetDependencies,
): Promise<ConnectTarget> {
  if (locationId.startsWith("srv-")) {
    const server = dependencies.servers.find((candidate) => toServerLocationId(candidate.name) === locationId);
    if (server) return { kind: "server", locationId, country: server.country, connectName: server.name };

    const favorite = dependencies.favorites.find((candidate) => candidate.id === locationId && candidate.kind === "server");
    if (favorite?.serverName === undefined) throw new UnknownConnectTargetError(locationId);
    if (provider.locationTarget?.unavailableFavorite === "countryFallback" && provider.locationTarget.fallbackProvider !== undefined) {
      return {
        kind: "countryFallback", provider: provider.locationTarget.fallbackProvider, locationId, country: favorite.country,
        connectName: favorite.countryName, removeFavorite: true,
      };
    }
    if (provider.locationTarget?.unavailableFavorite === "error" && provider.locationTarget.errorProvider !== undefined) {
      return { kind: "favoriteUnavailable", provider: provider.locationTarget.errorProvider, locationId, error: "favorite_unavailable", removeFavorite: false };
    }
    throw new UnknownConnectTargetError(locationId);
  }

  const location = dependencies.locations.find((candidate) => candidate.id === locationId);
  if (!location || location.city === undefined) throw new UnknownConnectTargetError(locationId);
  const knownCities = dependencies.cities.find((entry) => entry.country.toLowerCase() === location.country.toLowerCase())?.cities ?? [];
  const city = knownCities.find((candidate) => candidate === location.city);
  if (city === undefined) throw new UnknownConnectTargetError(locationId);

  if (provider.locationTarget?.city === "cityName") {
    return { kind: "cityByName", locationId, country: location.country, connectName: city };
  }
  if (provider.locationTarget?.city !== "fastestServer") throw new UnknownConnectTargetError(locationId);
  const fastest = dependencies.servers
    .filter((server) => server.country.toLowerCase() === location.country.toLowerCase() && server.city === city)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "en"))[0];
  if (!fastest) throw new UnknownConnectTargetError(locationId);
  return { kind: "city", locationId, country: location.country, connectName: fastest.name };
}
