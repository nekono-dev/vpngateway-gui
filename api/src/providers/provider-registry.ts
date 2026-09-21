// 責務: 管理者が有効化したVPNベンダー（プロファイル）の読み込み・検証と、ID→ベンダーの引き当て。
// Phase 11で、従来の「1つのプロファイル（VPN_PROFILE_PATH）」から、複数ベンダーを持つ形へ改めた
// （apiserver/design.md「ベンダーの選択」）。有効なベンダーは環境変数`ENABLED_PROVIDERS`（カンマ区切りのベンダーID）、
// プロファイルは`VPN_PROFILES_DIR/<ベンダーID>.json`（ファイル名＝ベンダーID。ファイル内の`vendor`と一致させる）。
// :roマウントされ実行時に変化しない前提のため、初回に読み込んでキャッシュする。

import { join } from "node:path";
import { parseProfileFile } from "../profile/profile-loader.js";
import type { VendorProfile } from "../profile/profile.schema.js";

export interface Provider {
  // ベンダーID（プロファイルのファイル名。例 "adguardvpn"）。
  id: string;
  // 画面に出すベンダー名（プロファイルの`displayName`、無ければ`vendor`）。
  displayName: string;
  profile: VendorProfile;
}

// ベンダーIDの形式。ファイル名・UDSのソケット名・状態ディレクトリ名に使うため、文字種を絞る（パス注入を防ぐ）。
export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9]{0,31}$/;

let cached: Provider[] | undefined;

/**
 * 目的: 有効なベンダーのプロファイルを全て読み込み、検証して返す（初回のみ読み込み、以後はキャッシュ）。
 * 入力: なし（環境変数`ENABLED_PROVIDERS`（既定"adguardvpn"）・`VPN_PROFILES_DIR`（既定/etc/vpngwgui/profiles））。
 * 出力: 有効化された順のProvider配列（1件以上）。
 * 失敗時の方針: ID形式の不正・重複・有効なベンダーが0件・プロファイルの読み込み/検証失敗・
 *              ファイル内の`vendor`とIDの不一致は、例外を投げて起動を失敗させる（不正な管理者向け設定のまま
 *              誤ったコマンドを解決しないため）。
 * 例: getProviders().map((provider) => provider.id) // => ["adguardvpn", "protonvpn"]
 */
export function getProviders(): Provider[] {
  if (cached) return cached;
  const dir = process.env.VPN_PROFILES_DIR ?? "/etc/vpngwgui/profiles";
  const ids = (process.env.ENABLED_PROVIDERS ?? "adguardvpn")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0) {
    throw new Error("no VPN provider is enabled (ENABLED_PROVIDERS is empty)");
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error(`duplicate provider id in ENABLED_PROVIDERS: ${ids.join(",")}`);
  }
  cached = ids.map((id) => {
    if (!PROVIDER_ID_PATTERN.test(id)) {
      throw new Error(`invalid provider id: ${id}`);
    }
    const profile = parseProfileFile(join(dir, `${id}.json`));
    if (profile.vendor !== id) {
      throw new Error(`profile "${id}.json" declares vendor "${profile.vendor}" (must equal the file name)`);
    }
    return { id, displayName: profile.displayName ?? profile.vendor, profile };
  });
  return cached;
}

/**
 * 目的: IDから有効なベンダーを引き当てる。
 * 入力: id(ベンダーID)。
 * 出力: 該当するProvider。有効でない・未知のIDならundefined。
 */
export function findProvider(id: string): Provider | undefined {
  return getProviders().find((provider) => provider.id === id);
}

/** テスト用: キャッシュを破棄して、次回呼び出しで環境変数から読み直させる。 */
export function resetProviderRegistryForTest(): void {
  cached = undefined;
}
