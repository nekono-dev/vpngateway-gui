// 責務: `account`アクション（副作用のない読み取り専用コマンド）の出力から、ログイン状態・契約プランを判定し、
// 結果を短時間キャッシュする（apiserver/design.md「ログイン状態・プランの判定」）。
// Web UIが5秒周期で取得してもCLIの起動が最大30秒に1回になるようにするため。

import type { Provider } from "../providers/provider-registry.js";
import { resolveArgv } from "../profile/placeholder-resolver.js";
import type { AccountActionDef } from "../profile/profile.schema.js";
import { executeVendorCommand } from "../proxy-client/proxy-client.js";
import { matchesPattern } from "../lib/regex-match.js";
import { stripAnsi } from "../lib/strip-ansi.js";
import type { SessionInfo } from "../capabilities/capability-evaluator.js";

const CACHE_TTL_MS = 30_000;

// ベンダーごとに別々にキャッシュする（Phase 11。ログイン状態・プランはベンダーごとに異なる）。
const cachedByProvider = new Map<string, { info: SessionInfo; expiresAt: number }>();
// 実行中の判定（ベンダーごと）。同時に来た要求を1回のCLI実行へまとめる。
const inFlightByProvider = new Map<string, Promise<SessionInfo>>();

/**
 * 目的: `account`の実行結果（終了コード・出力）から、ログイン状態・プランを判定する。純粋関数。
 * 入力: account(`account`アクション定義), exitCode(終了コード。タイムアウト等は-1), output(標準出力・標準エラーの連結。ANSI除去済み)。
 * 出力: SessionInfo。
 *       - `notLoggedInPattern`に一致 → 未ログイン（終了コードは問わない。Proton VPNは未ログイン時に終了コード2）。
 *       - 一致せず終了コードが0以外 → 不明（空オブジェクト）。
 *       - 終了コード0 → ログイン済み。`plans`を先頭から評価し最初に一致した要素、無ければ`defaultPlan`。
 * 例: evaluateAccountOutput(account, 0, "... Upgrade to enable ...") // => { loggedIn: true, plan: { id: "free", ... } }
 */
export function evaluateAccountOutput(account: AccountActionDef, exitCode: number, output: string): SessionInfo {
  if (account.notLoggedInPattern !== undefined && matchesPattern(output, account.notLoggedInPattern, "i")) {
    return { loggedIn: false };
  }
  if (exitCode !== 0) {
    return {};
  }
  const matched = account.plans.find((plan) => matchesPattern(output, plan.pattern, "i"));
  if (matched) {
    return {
      loggedIn: true,
      plan: {
        id: matched.id,
        label: matched.label,
        restricts: matched.restricts,
        ...(matched.restrictionMessage === undefined ? {} : { restrictionMessage: matched.restrictionMessage }),
      },
    };
  }
  return { loggedIn: true, plan: { id: account.defaultPlan.id, label: account.defaultPlan.label, restricts: [] } };
}

/**
 * 目的: そのベンダーの現在のログイン状態・プランを取得する（30秒キャッシュ）。
 * 入力: provider(対象のベンダー)。
 * 出力: SessionInfo。`account`が未定義、または実行に失敗（プロキシ未応答・タイムアウト等）した場合は
 *       空オブジェクト（不明）。不明な場合は制限をかけない方針のため例外にしない。
 * 副作用: キャッシュが無い・期限切れの場合、プロキシ上で`account`を1回実行する。失敗（不明）はキャッシュしない
 *        （次の要求で再判定する）。
 * 例: const { loggedIn, plan } = await getSessionInfo();
 */
export async function getSessionInfo(provider: Provider): Promise<SessionInfo> {
  const { profile } = provider;
  const account = profile.actions.account;
  if (account === undefined) return {};

  const cached = cachedByProvider.get(provider.id);
  if (cached && cached.expiresAt > Date.now()) return cached.info;
  const pending = inFlightByProvider.get(provider.id);
  if (pending) return pending;

  const inFlight = (async () => {
    try {
      const result = await executeVendorCommand(provider.id, {
        vendor: profile.vendor,
        binary: profile.binary,
        resolvedArgv: resolveArgv(profile, "account", {}),
        timeoutMs: account.timeoutMs,
      });
      const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
      const info = evaluateAccountOutput(account, result.exitCode ?? -1, output);
      // 判定できた（ログイン状態が分かった）結果のみキャッシュする。
      if (info.loggedIn !== undefined) {
        cachedByProvider.set(provider.id, { info, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return info;
    } catch {
      // プロキシ未応答・タイムアウトは「不明」として扱う（CLIの障害は他のエンドポイントが別途報告する）。
      return {};
    } finally {
      inFlightByProvider.delete(provider.id);
    }
  })();
  inFlightByProvider.set(provider.id, inFlight);
  return inFlight;
}

/**
 * 目的: そのベンダーのキャッシュ済みのログイン状態・プランを破棄する。
 * 入力: providerId(対象のベンダーID)。
 * 副作用: ログイン・ログアウトの成功時に呼ぶ（状態が変わったため次の取得で再判定させる）。
 */
export function invalidateSessionInfo(providerId: string): void {
  cachedByProvider.delete(providerId);
}
