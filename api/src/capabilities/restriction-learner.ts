// 責務: 実行失敗の出力から「プラン制限による失敗」を検出し、対応するオペレーションを制限として学習（記憶）する。
// `account`で判定できない制限への備え（apiserver/design.md「実行失敗からの学習」）。記憶はプロセス内メモリのみで、
// ログイン・ログアウトの成功、およびAPIの再起動で消える（プラン変更後の再ログインで自然に解除される）。

import { CommandExecutionError, OperationRestrictedError } from "../errors.js";
import { matchesPattern } from "../lib/regex-match.js";
import type { OperationKey } from "./operations.js";

// ベンダーごとに別々に学習する（Phase 11。あるベンダーのプラン制限が別のベンダーの操作を塞がないように）。
const learnedByProvider = new Map<string, Map<OperationKey, string>>();
const EMPTY: ReadonlyMap<OperationKey, string> = new Map();

const RESTRICTED_MESSAGE = "現在のプランでは利用できない操作です";

/**
 * 目的: 学習済みの制限（オペレーション→理由文）を返す。
 * 入力: providerId(対象のベンダーID)。
 * 出力: 読み取り専用のMap（呼び出し側は変更しない）。
 */
export function getLearnedRestrictions(providerId: string): ReadonlyMap<OperationKey, string> {
  return learnedByProvider.get(providerId) ?? EMPTY;
}

/**
 * 目的: そのベンダーの学習済みの制限を全て破棄する。
 * 入力: providerId(対象のベンダーID)。
 * 副作用: ログイン・ログアウト成功時に呼ぶ（プランが変わりうるため）。
 */
export function clearLearnedRestrictions(providerId: string): void {
  learnedByProvider.delete(providerId);
}

/**
 * 目的: コマンドの実行失敗を、プラン制限（403）か通常の実行失敗（422）かに振り分けて例外を投げる。
 *      プラン制限と判定した場合は、対応するオペレーションを制限として学習する。
 * 入力: providerId(対象のベンダーID), message(通常の失敗時のエラーメッセージ), exitCode(非ゼロの終了コード),
 *       output(診断テキスト。ANSI除去済みのstderrまたはstdout),
 *       restriction(省略可。`restrictedPattern`（正規表現ソース）と、一致時に制限するオペレーション)。
 * 出力: 常に例外を投げる（戻らない）。
 * 失敗時の方針: `restriction`が無い、またはパターン不一致ならCommandExecutionError（422）。一致すれば
 *              OperationRestrictedError（403）。
 * 例: throwCommandFailure("vendora", "connect failed", 2, "Location selection is not available on this plan.",
 *       { pattern: "not available on this plan", operation: "connectToLocation" })
 */
export function throwCommandFailure(
  providerId: string,
  message: string,
  exitCode: number,
  output: string,
  restriction?: { pattern: string | undefined; operation: OperationKey },
): never {
  if (restriction?.pattern !== undefined && matchesPattern(output, restriction.pattern, "i")) {
    const learned = learnedByProvider.get(providerId) ?? new Map<OperationKey, string>();
    learned.set(restriction.operation, RESTRICTED_MESSAGE);
    learnedByProvider.set(providerId, learned);
    throw new OperationRestrictedError(RESTRICTED_MESSAGE, exitCode, output);
  }
  throw new CommandExecutionError(message, exitCode, output);
}
