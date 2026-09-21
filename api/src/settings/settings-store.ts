// 責務: ユーザ向け設定（Web UIから変更可能な運用設定）の永続化。
// Phase 1では単一JSONファイルへのread-modify-writeで十分（低頻度更新・単一ユーザーLAN内運用のため）。
// 同時書き込み競合の考慮は行わない（wbs/phase7.mdで見直し候補として申し送り済み）。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isIpv4Cidr } from "../lib/ipv4-cidr.js";
import { matchesPattern } from "../lib/regex-match.js";
import type { UserSettings, UserSettingsPatch } from "../schemas/settings.js";

const SETTINGS_FILE = process.env.SETTINGS_FILE ?? "/var/lib/vpngwgui/settings.json";

const DEFAULT_SETTINGS: UserSettings = {
  killSwitch: true,
  excludedDomains: [],
  transparentGatewayEnabled: false,
  explicitProxyEnabled: false,
  explicitProxyAllowedCidrs: [],
};

// ホスト名として妥当な形式のみを許可する（RFC 1123の簡略版）。
const DOMAIN_PATTERN = "^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$";

export class SettingsValidationError extends Error {}

/**
 * 目的: `excludedDomains`の各要素がドメイン形式として妥当かを検証する。
 * 入力: domains(検証対象のドメイン文字列配列)。
 * 出力: なし。不正な要素があればSettingsValidationErrorを投げる。
 */
function validateExcludedDomains(domains: string[]): void {
  for (const domain of domains) {
    if (!matchesPattern(domain, DOMAIN_PATTERN)) {
      throw new SettingsValidationError(`invalid domain format: ${domain}`);
    }
  }
}

/**
 * 目的: `explicitProxyAllowedCidrs`の各要素がIPv4 CIDR形式として妥当かを検証する。
 * 入力: cidrs(検証対象のCIDR文字列配列)。
 * 出力: なし。不正な要素があればSettingsValidationErrorを投げる。
 * 理由: 値はproxyコンテナで3proxyの設定ファイルへ埋め込まれるため、設定行の注入や意図しない許可範囲の拡大を
 *      入口（保存前）で防ぐ（proxy側でも再検証する）。IPv6は本プロジェクトの対象外（proxyserver/design.md）。
 */
function validateAllowedCidrs(cidrs: string[]): void {
  for (const cidr of cidrs) {
    if (!isIpv4Cidr(cidr)) {
      throw new SettingsValidationError(`invalid CIDR format (IPv4 CIDR expected, e.g. 192.168.3.0/24): ${cidr}`);
    }
  }
}

/**
 * 目的: 永続化済みのユーザ向け設定を取得する。未作成の場合はデフォルト値を返す。
 * 入力: なし。
 * 出力: UserSettings。保存ファイルに現行スキーマに無い項目（Phase 8で廃止した`defaultCountry`等）が
 *       残っていても無視し、保存ファイルに無い項目はデフォルト値で補う。
 */
export function getSettings(): UserSettings {
  if (!existsSync(SETTINGS_FILE)) {
    return DEFAULT_SETTINGS;
  }
  const stored: Record<string, unknown> = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
  const known = Object.keys(DEFAULT_SETTINGS).filter((key) => key in stored);
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(known.map((key) => [key, stored[key]])) };
}

/**
 * 目的: ユーザ向け設定を部分更新し、永続化する。
 * 入力: patch(更新したいフィールドのみを含む部分オブジェクト)。
 * 出力: 更新後の完全なUserSettings。
 * 失敗時の方針: `excludedDomains`がドメイン形式、`explicitProxyAllowedCidrs`がIPv4 CIDR形式を
 *              満たさない場合はSettingsValidationErrorを投げる
 *              （呼び出し元でHTTP 400へマッピングする）。
 * 副作用: SETTINGS_FILEへ書き込む。プロキシへの実反映（nftables再構成等）は呼び出し元
 *        （routes/connection-config.ts）がnotifySettings()を介して行う（本関数の責務ではない）。
 */
export function updateSettings(patch: UserSettingsPatch): UserSettings {
  if (patch.excludedDomains) {
    validateExcludedDomains(patch.excludedDomains);
  }
  if (patch.explicitProxyAllowedCidrs) {
    validateAllowedCidrs(patch.explicitProxyAllowedCidrs);
  }
  const next: UserSettings = { ...getSettings(), ...patch };
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}
