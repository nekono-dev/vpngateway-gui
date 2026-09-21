// 責務: プロファイルからアクション定義を取り出す。定義が無い（プロバイダ非対応）場合は
// OperationUnsupportedError（501）を投げる。Phase 9で多くのアクションが省略可になったため、
// 各ルートが未定義チェックを重複して書かずに済むよう一箇所にまとめる。

import { OperationUnsupportedError } from "../errors.js";
import type { VendorProfile } from "./profile.schema.js";

type Actions = VendorProfile["actions"];

/**
 * 目的: アクション定義を取得する。未定義なら「このプロバイダでは非対応」として失敗させる。
 * 入力: profile(検証済みプロファイル), name(アクション名)。
 * 出力: アクション定義（undefinedを含まない型）。
 * 失敗時の方針: 未定義ならOperationUnsupportedErrorを投げる（HTTP 501へマッピングされる）。
 * 例: requireAction(profile, "listLocations").argv // => ["list-locations"]
 */
export function requireAction<K extends keyof Actions>(profile: VendorProfile, name: K): NonNullable<Actions[K]> {
  const action = profile.actions[name];
  if (action === undefined) {
    throw new OperationUnsupportedError(`this VPN provider does not support the "${name}" action`);
  }
  return action as NonNullable<Actions[K]>;
}
