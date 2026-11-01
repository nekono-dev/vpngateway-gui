// 責務: AdGuard VPN の device 認証（承認の URL とコードの表示、承認の待ち）。要件 3.1〜3.5。
// 承認は開発者の別の端末で行う。検証サーバの画面は開かない（要件 3.5）。

import type { ApiClient } from "../../../common/api-client";
import type { AbortReason, PrepareIo, VendorSessionState } from "../prepare-types";

/** GET /v1/session のうち、本ツールが読む部分。 */
interface SessionBody {
  readonly loggedIn?: boolean;
  readonly loginUrl?: string;
  readonly plan?: { readonly id: string; readonly label: string };
}

/** 承認の確認の間隔と上限（要件 3.4）。 */
export const APPROVAL_POLL_MS = 5_000;
export const APPROVAL_TIMEOUT_MS = 300_000;

/** 待機の依存（テストでは差し替える）。 */
export interface AdGuardDeps {
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

const realDeps: AdGuardDeps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/**
 * 目的: AdGuard VPN のプロバイダを有効にし、device 認証を開始して、承認の完了まで待つ。
 * 入力: api(管理者の Cookie を保持する)、io(表示)、deps(待機と時刻)。
 * 出力: 承認の完了後の VendorSessionState（プラン付き）。失敗なら理由。
 * 失敗時の方針: 5 分を過ぎても承認されなければ device-approval-timeout で中止する。
 */
export async function prepareAdGuard(
  api: ApiClient,
  io: PrepareIo,
  deps: AdGuardDeps = realDeps,
): Promise<{ ok: true; state: VendorSessionState } | { ok: false; reason: AbortReason }> {
  const active = await api.put("/v1/providers/active", { providerId: "adguardvpn" });
  if (!active.ok) return { ok: false, reason: { kind: "vendor-unreachable" } };

  const started = await api.post<SessionBody>("/v1/session");
  if (!started.ok) {
    if (started.kind === "transport") return { ok: false, reason: { kind: "vendor-unreachable" } };
    return { ok: false, reason: { kind: "vendor-auth-failed", message: started.message } };
  }
  if (started.body.loginUrl !== undefined) {
    io.print("");
    io.print("【AdGuard の承認】");
    io.print(`  開発者の別の端末のブラウザで次を開き、承認する: ${started.body.loginUrl}`);
    io.print("  承認が完了するまで待つ（上限 5 分）");
  }

  const deadline = deps.now() + APPROVAL_TIMEOUT_MS;
  for (;;) {
    const state = await api.get<SessionBody>("/v1/session");
    if (!state.ok) return { ok: false, reason: { kind: "vendor-unreachable" } };
    if (state.body.loggedIn === true) {
      const planId = state.body.plan?.id ?? "unknown";
      io.print(`AdGuard の承認を確認した。プラン: ${state.body.plan?.label ?? "不明"}（${planId}）`);
      return { ok: true, state: { vendor: "adguardvpn", planId } };
    }
    if (deps.now() >= deadline) return { ok: false, reason: { kind: "device-approval-timeout" } };
    await deps.sleep(APPROVAL_POLL_MS);
  }
}
