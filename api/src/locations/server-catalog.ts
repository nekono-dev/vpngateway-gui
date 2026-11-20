// 責務: CLIが管理するサーバ一覧キャッシュを宣言に従って読み、都市ごとの接続可能なサーバを選ぶ。

import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { ServerCatalog as ServerCatalogDef } from "../profile/profile.schema.js";

export interface ServerRecord {
  readonly name: string;
  readonly country: string;
  readonly city: string;
  readonly tier: "free" | "paid";
  readonly load: number;
  readonly score: number;
}

/** 宣言されたファイルを読み取る。ファイル・JSON・一覧形式の不備は呼び出し元へ例外として伝える。 */
export function readCatalog(providerId: string, declaration: ServerCatalogDef): unknown {
  const cacheRoot = realpathSync(resolve(process.env.PROVIDER_CACHE_DIR ?? "/var/lib/vpngwgui-provider-cache"));
  const providerDir = resolve(cacheRoot, providerId);
  const declaredFile = resolve(providerDir, declaration.file);
  if (!declaredFile.startsWith(providerDir + sep)) throw new Error("server catalog file is outside provider cache directory");
  const file = realpathSync(declaredFile);
  if (!file.startsWith(cacheRoot + sep)) throw new Error("server catalog file is outside provider cache directory");
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as Record<string, unknown>)[declaration.list])) {
    throw new Error(`invalid server catalog: expected array at ${declaration.list}`);
  }
  return parsed;
}

/** キャッシュから指定都市の有効な非 Secure Core サーバをScore・名前順で返す。 */
export function serversInCity(
  providerId: string,
  declaration: ServerCatalogDef,
  country: string,
  city: string,
): ServerRecord[] {
  return availableServers(providerId, declaration).filter((server) => server.country === country.toLowerCase() && server.city === city);
}

/** キャッシュから有効な通常サーバを返す。接続先の解決と都市の一覧で同じ条件を使う。 */
export function availableServers(providerId: string, declaration: ServerCatalogDef): ServerRecord[] {
  const catalog = readCatalog(providerId, declaration) as Record<string, unknown>;
  const rows = catalog[declaration.list] as unknown[];
  const result: ServerRecord[] = [];
  for (const item of rows) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("invalid server catalog: server entry must be an object");
    }
    const row = item as Record<string, unknown>;
    const name = row[declaration.name];
    const rowCountry = row[declaration.country];
    const rowCity = row[declaration.city];
    const tier = row[declaration.tier];
    const features = row[declaration.features];
    const status = row[declaration.status];
    const score = row[declaration.score];
    const load = row[declaration.load];
    if (typeof name !== "string" || typeof rowCountry !== "string" || typeof rowCity !== "string" ||
        typeof tier !== "number" || typeof features !== "number" || !Number.isInteger(features) ||
        (typeof status !== "boolean" && typeof status !== "number") ||
        typeof score !== "number" || !Number.isFinite(score) || typeof load !== "number" || !Number.isFinite(load)) {
      throw new Error("invalid server catalog: server entry fields have unexpected types");
    }
    if ((status !== true && status !== 1) || (features & 1) !== 0) continue;
    result.push({ name, country: rowCountry.toLowerCase(), city: rowCity, tier: tier === 0 ? "free" : "paid", load, score });
  }
  return result.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "en"));
}

/** 都市の最速サーバ。対象が無ければundefined。 */
export function fastestServer(
  providerId: string,
  declaration: ServerCatalogDef,
  country: string,
  city: string,
): ServerRecord | undefined {
  return serversInCity(providerId, declaration, country, city)[0];
}
