// 責務: 選択可能な接続国一覧を返すエンドポイント。

import type { FastifyPluginAsync } from "fastify";
import { CountriesResponseSchema } from "../schemas/connection.js";
import { loadVendorProfile } from "../profile/profile-loader.js";

export const registerConnectionCountriesRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/v1/connection/countries",
    { schema: { response: { 200: CountriesResponseSchema } } },
    async () => {
      const profile = loadVendorProfile();
      return profile.countries;
    },
  );
};
