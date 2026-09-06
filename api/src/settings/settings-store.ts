// 責務: ユーザ向け設定（Web UIから変更可能な運用設定）の永続化。
// Phase 1では単一JSONファイルへのread-modify-writeで十分（低頻度更新・単一ユーザーLAN内運用のため）。
// 同時書き込み競合の考慮は行わない（wbs/phase7.mdで見直し候補として申し送り済み）。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { matchesPattern } from "../lib/regex-match.js";
import type { UserSettings, UserSettingsPatch } from "../schemas/settings.js";

const SETTINGS_FILE = process.env.SETTINGS_FILE ?? "/var/lib/vpngwgui/settings.json";

const DEFAULT_SETTINGS: UserSettings = {
  killSwitch: true,
  excludedDomains: [],
  defaultCountry: "jp",
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
 * 目的: 永続化済みのユーザ向け設定を取得する。未作成の場合はデフォルト値を返す。
 * 入力: なし。
 * 出力: UserSettings。
 */
export function getSettings(): UserSettings {
  if (!existsSync(SETTINGS_FILE)) {
    return DEFAULT_SETTINGS;
  }
  return JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
}

/**
 * 目的: ユーザ向け設定を部分更新し、永続化する。
 * 入力: patch(更新したいフィールドのみを含む部分オブジェクト)。
 * 出力: 更新後の完全なUserSettings。
 * 失敗時の方針: `excludedDomains`がドメイン形式を満たさない場合はSettingsValidationErrorを投げる
 *              （呼び出し元でHTTP 400へマッピングする）。
 * 副作用: SETTINGS_FILEへ書き込む。Phase 1ではプロキシへの実反映は行わない。
 */
export function updateSettings(patch: UserSettingsPatch): UserSettings {
  if (patch.excludedDomains) {
    validateExcludedDomains(patch.excludedDomains);
  }
  const next: UserSettings = { ...getSettings(), ...patch };
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}
