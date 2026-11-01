// 責務: Proton VPN のログイン（資格情報と 2FA の入力、ログイン、プランの確認）。要件 2.1〜2.5。

import type { ApiClient } from "../../../common/api-client";
import type { AbortReason, PrepareIo, VendorSessionState } from "../prepare-types";

/** GET /v1/session のうち、本ツールが読む部分。 */
interface SessionBody {
  readonly loggedIn?: boolean;
  readonly plan?: { readonly id: string; readonly label: string };
}

/**
 * 目的: Proton VPN のプロバイダを有効にし、資格情報と 2FA のコードで API にログインし、プランを表示する。
 * 入力: api(管理者の Cookie を保持する)、io(非表示の入力と表示)。
 * 出力: 成功なら VendorSessionState（プラン付き）。失敗なら理由。
 * 失敗時の方針: 認証の失敗は vendor-auth-failed（API の message のみ表示）、到達の失敗は vendor-unreachable で直ちに中止する。
 *   2FA のコードは、入力の直後にログインへ送る（保留しない。コードの有効期間との競合を避ける）。
 */
export async function prepareProton(
  api: ApiClient,
  io: PrepareIo,
): Promise<{ ok: true; state: VendorSessionState } | { ok: false; reason: AbortReason }> {
  const active = await api.put("/v1/providers/active", { providerId: "protonvpn" });
  if (!active.ok) return { ok: false, reason: { kind: "vendor-unreachable" } };

  const username = await io.hidden("Proton のユーザー名: ");
  const password = await io.hidden("Proton のパスワード: ");
  const twoFactorCode = await io.hidden("2FA のコード（表示されない。入力後に Enter）: ");

  const login = await api.post("/v1/session", {
    username,
    password,
    ...(twoFactorCode === "" ? {} : { twoFactorCode }),
  });
  if (!login.ok) {
    if (login.kind === "transport") return { ok: false, reason: { kind: "vendor-unreachable" } };
    return { ok: false, reason: { kind: "vendor-auth-failed", message: login.message } };
  }

  const session = await api.get<SessionBody>("/v1/session");
  if (!session.ok) return { ok: false, reason: { kind: "vendor-unreachable" } };
  const planId = session.body.plan?.id;
  if (planId === undefined) return { ok: false, reason: { kind: "vendor-auth-failed", message: "プランを取得できない" } };

  io.print(`Proton のプラン: ${session.body.plan?.label ?? planId}（${planId}）`);
  return { ok: true, state: { vendor: "protonvpn", planId } };
}
