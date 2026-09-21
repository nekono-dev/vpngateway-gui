// 責務: 操作（オペレーション）ごとの実行可否（capability）の取得（GET）。
// apiserver/design.md「オペレーションと実行可否（capability）」に対応する。ログイン状態・プランは
// `account`アクションの判定（30秒キャッシュ）を使い、判定できない場合は制限しない。
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { CapabilitiesResponseSchema } from "../schemas/capabilities.js";
import { loadVendorProfile } from "../profile/profile-loader.js";
import { evaluateCapabilities } from "../capabilities/capability-evaluator.js";
import { getLearnedRestrictions } from "../capabilities/restriction-learner.js";
import { getSessionInfo } from "../session/session-probe.js";

export const registerConnectionCapabilitiesRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/connection/capabilities",
    { schema: { response: { 200: CapabilitiesResponseSchema } } },
    async () => {
      const profile = loadVendorProfile();
      const session = await getSessionInfo();
      return { capabilities: evaluateCapabilities(profile, session, getLearnedRestrictions()) };
    },
  );
};
