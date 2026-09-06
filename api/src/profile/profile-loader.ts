// 責務: 管理者向け設定「VPNクライアント操作プロファイル」JSONファイルの読み込み・検証。
// 起動時に一度読み込み、以後はキャッシュを返す（:roマウントされ実行時に変化しない前提）。

import { readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { VendorProfileSchema, type VendorProfile } from "./profile.schema.js";

const PROFILE_PATH = process.env.VPN_PROFILE_PATH ?? "/etc/vpngwgui/vpn-profile.json";

let cachedProfile: VendorProfile | undefined;

/**
 * 目的: プロファイルJSONを読み込み、スキーマ検証した上で返す。
 * 入力: なし（環境変数VPN_PROFILE_PATHで指定されたファイルを読む）。
 * 出力: 検証済みのVendorProfile。
 * 失敗時の方針: JSONパース失敗・スキーマ不一致の場合は例外を投げ、アプリケーション起動を失敗させる
 *              （不正な管理者向け設定のまま起動を続けると、誤ったコマンドを解決しかねないため）。
 */
export function loadVendorProfile(): VendorProfile {
  if (cachedProfile) return cachedProfile;

  const raw: unknown = JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
  if (!Value.Check(VendorProfileSchema, raw)) {
    const errors = [...Value.Errors(VendorProfileSchema, raw)].slice(0, 5);
    throw new Error(`invalid vendor profile at ${PROFILE_PATH}: ${JSON.stringify(errors)}`);
  }

  cachedProfile = raw;
  return cachedProfile;
}
