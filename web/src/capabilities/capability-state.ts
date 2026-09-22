// 責務: APIが返す操作ごとの実行可否（capabilities）を、UI部品が使いやすい形で参照する純粋関数群。
// 実行可否の判定自体はAPIが行う（specs/apiserver/design.md「オペレーションと実行可否（capability）」）。
// ここは受け取った値の参照と、取得できないときの既定値（制限しない）のみを扱う。
// API応答の型に依存するドメイン処理のため、汎用のlib/ではなく責務ディレクトリcapabilities/に置く。

import type { GetV1ConnectionCapabilities200 } from "../generated/api/endpoints.schemas";

export type Capabilities = GetV1ConnectionCapabilities200["capabilities"];
export type OperationKey = keyof Capabilities;

/**
 * 目的: 操作が実行可能かを返す。実行可否を取得できていない（未取得・取得失敗）場合は、判定できないことを
 *      理由に操作を塞がないため、実行可能として扱う。
 * 入力: capabilities(`GET /v1/connection/capabilities`の応答。未取得ならundefined), key(操作)。
 * 出力: 実行可能ならtrue。
 * 例: isAvailable(undefined, "connectToLocation") // => true
 */
export function isAvailable(capabilities: Capabilities | undefined, key: OperationKey): boolean {
  return capabilities?.[key].available ?? true;
}

/**
 * 目的: 操作が実行できない理由文（APIが返した日本語）を返す。
 * 入力: capabilities(未取得ならundefined), key(操作)。
 * 出力: 実行不可なら理由文。実行可能・未取得ならundefined。理由文が無い実行不可は汎用文にする。
 * 例: reasonOf(caps, "locationList") // => "無料プランでは接続先を選べません。"
 */
export function reasonOf(capabilities: Capabilities | undefined, key: OperationKey): string | undefined {
  const capability = capabilities?.[key];
  if (!capability || capability.available) return undefined;
  return capability.message ?? "この操作は利用できません";
}

/**
 * 目的: このベンダーのCLIがping計測に対応しているかを返す（プラン制限で計測できない状態とは区別する）。
 *      `pingMeasurement`は接続先一覧（`locationList`）に従属するcapabilityで、一覧自体がプラン制限で
 *      使えないときはプラン制限の理由を継承するため、`reason === "unsupported"`のときだけ非対応と判定する
 *      （継承した`planRestricted`はプロバイダの非対応を意味しないため）。
 * 入力: capabilities(未取得ならundefined)。
 * 出力: 非対応と判定できるときだけfalse。それ以外（対応・不明）はtrue。
 * 例: supportsLocationPing({ pingMeasurement: { available: false, reason: "unsupported" }, ... }) // => false
 */
export function supportsLocationPing(capabilities: Capabilities | undefined): boolean {
  return capabilities?.pingMeasurement?.reason !== "unsupported";
}

/**
 * 目的: ［接続］を「接続先を指定しない接続（connectAuto）」として使うかを決める。
 *      接続先を選んで接続できるとき（connectToLocation）はそちらを優先し、使えず自動接続が使えるときだけ自動接続にする
 *      （webserver/requirements.md「操作の制限表示」）。
 * 入力: capabilities(未取得ならundefined)。
 * 出力: 自動接続として使うならtrue。
 * 例: usesAutoConnect(freePlanCaps) // => true
 */
export function usesAutoConnect(capabilities: Capabilities | undefined): boolean {
  return !isAvailable(capabilities, "connectToLocation") && isAvailable(capabilities, "connectAuto");
}

/**
 * 目的: 接続できないときの理由文を選ぶ。接続先指定・自動接続の両方が使えないとき、非対応（unsupported）でない方の
 *      理由（未ログイン等）を優先して表示する（利用者が解消できる原因を示すため）。
 * 入力: capabilities(未取得ならundefined)。
 * 出力: 接続可能ならundefined。両方不可なら理由文。
 */
export function connectBlockedReason(capabilities: Capabilities | undefined): string | undefined {
  if (isAvailable(capabilities, "connectToLocation") || isAvailable(capabilities, "connectAuto")) return undefined;
  const candidates = [capabilities?.connectToLocation, capabilities?.connectAuto];
  const actionable = candidates.find((capability) => capability && capability.reason !== "unsupported");
  return (actionable ?? candidates[0])?.message ?? "接続できません";
}
