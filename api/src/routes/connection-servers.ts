// 責務: 都市ごとの接続可能なサーバ一覧をCLI管理キャッシュから返す。
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { ServerRowSchema } from "../schemas/location.js";
import { readCatalog, serversInCity } from "../locations/server-catalog.js";
import { LOCATION_ID_PATTERN, toLocationId, toServerLocationId } from "../locations/location-id.js";
import { getActiveProvider } from "../providers/active-provider-store.js";
import { readFavoriteLocationIds } from "../locations/favorite-locations-store.js";


const ParamsSchema = Type.Object({ cityId: Type.String({ pattern: LOCATION_ID_PATTERN }) });

export const registerConnectionServersRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/connection/locations/:cityId/servers",
    { schema: { params: ParamsSchema, response: { 200: Type.Array(ServerRowSchema), 400: ErrorResponseSchema, 404: ErrorResponseSchema } } },
    async (request, reply) => {
      const provider = getActiveProvider();
      const declaration = provider.profile.serverCatalog;
      if (!declaration) return reply.code(404).send({ error: "not_found", message: "Server list is not available" });

      const match = /^([a-z]{2})-(.+)$/.exec(request.params.cityId);
      if (!match) return reply.code(404).send({ error: "not_found", message: "City was not found" });
      const country = match[1];
      const cityId = request.params.cityId;
      // City name is catalog data; locate matching rows by checking cities represented in the catalog.
      const city = readCatalogRows(provider.id, declaration)
        .find((row) => row.country === country && toLocationId(country, row.city) === cityId)?.city;
      if (!city) return reply.code(404).send({ error: "not_found", message: "City was not found" });
      const favorites = new Set(readFavoriteLocationIds(provider.id));
      const statusResponse = await fastify.inject({ method: "GET", url: "/v1/connection", headers: request.headers });
      const connection = statusResponse.statusCode === 200 ? statusResponse.json<{ status: string; location?: string }>() : undefined;
      const connectedLocation = connection?.status === "connected" ? connection.location : undefined;
      return serversInCity(provider.id, declaration, country, city).map((server) => ({
        name: server.name,
        tier: server.tier,
        load: server.load,
        score: server.score,
        favorite: favorites.has(toServerLocationId(server.name)),
        connected: connectedLocation === server.name || connectedLocation?.startsWith(`${server.name} `) === true,
      }));
    },
  );
};

// readCatalog validates the declared file and the cache boundary; use it to resolve the city from catalog data.
function readCatalogRows(providerId: string, declaration: NonNullable<ReturnType<typeof getActiveProvider>["profile"]["serverCatalog"]>) {
  const catalog = readCatalog(providerId, declaration) as Record<string, unknown>;
  const rows = catalog[declaration.list] as unknown[];
  return rows.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const country = row[declaration.country];
    const city = row[declaration.city];
    return typeof country === "string" && typeof city === "string" ? [{ country: country.toLowerCase(), city }] : [];
  });
}
