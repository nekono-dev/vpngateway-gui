// 責務: ユーザ向け設定（Web UIから変更可能な運用設定）の永続化。
// Phase 1では単一JSONファイルへのread-modify-writeで十分（低頻度更新・単一ユーザーLAN内運用のため）。
// 同時書き込み競合の考慮は行わない（見直し候補。specs/apiserver/tasks.md「将来課題」参照）。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isIpv4Address } from "../lib/ipv4-address.js";
import { isIpv4Cidr } from "../lib/ipv4-cidr.js";
import { matchesPattern } from "../lib/regex-match.js";
import type { UserSettings, UserSettingsPatch } from "../schemas/settings.js";

const SETTINGS_FILE = process.env.SETTINGS_FILE ?? "/var/lib/vpngwgui/settings.json";

const DEFAULT_SETTINGS: UserSettings = {
  killSwitch: true,
  excludedDomains: [],
  // 透過ゲートウェイと明示的プロキシは少なくとも一方が有効である必要があるため、初期値は透過ゲートウェイを有効にする。
  transparentGatewayEnabled: true,
  explicitProxyEnabled: false,
  explicitProxyAllowedCidrs: [],
  dnsRelayEnabled: false,
  dnsUpstreamUrl: "",
  dnsUpstreamCaPem: "",
  dnsFailureMode: "failClosed",
  dnsFallbackServers: [],
  dnsClientNameServers: [],
  dnsRedirectEnabled: false,
  dnsRedirectExcludedCidrs: [],
};

// ホスト名として妥当な形式のみを許可する（RFC 1123の簡略版）。先頭に`*.`を付けたワイルドカード表記
// （サブドメインのみを対象。`example.com`は完全一致）も許可する。
const DOMAIN_PATTERN = "^(\\*\\.)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$";
const MAX_EXCLUDED_DOMAINS = 200;
const MAX_FALLBACK_SERVERS = 3;
const MAX_CLIENT_NAME_SERVERS = 3;
const MAX_CA_PEM_LENGTH = 16 * 1024;
const CA_PEM_PATTERN = "^(-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\\r\\n ]+-----END CERTIFICATE-----\\s*)+$";

export class SettingsValidationError extends Error {}

/**
 * 目的: `excludedDomains`の各要素がドメイン形式として妥当かを検証する。
 * 入力: domains(検証対象のドメイン文字列配列)。
 * 出力: なし。不正な要素があればSettingsValidationErrorを投げる。
 */
function validateExcludedDomains(domains: string[]): void {
  if (domains.length > MAX_EXCLUDED_DOMAINS) {
    throw new SettingsValidationError(`too many excludedDomains (max ${MAX_EXCLUDED_DOMAINS})`);
  }
  for (const domain of domains) {
    if (domain.length > 255 || !matchesPattern(domain, DOMAIN_PATTERN)) {
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
 * 目的: DNS中継の設定（上流のDoH URL・CA・フォールバック先・リダイレクト除外CIDR）の形式を検証する。
 * 入力: patch(更新する項目。指定された項目のみ検証する)。
 * 出力: なし。不正があればSettingsValidationErrorを投げる。
 * 理由: 上流URLは`https://`のみ許可する（ClientIDをパスへ追記して転送するため、クエリ・フラグメント・認証情報は不可）。
 *      CAはPEM形式の証明書のみ、リダイレクト除外・フォールバックはIPv4のみ（proxyがnftのルール文字列へ埋め込むため入口で防ぐ）。
 */
function validateDnsSettings(patch: UserSettingsPatch): void {
  if (patch.dnsUpstreamUrl !== undefined && patch.dnsUpstreamUrl !== "") {
    let url: URL;
    try {
      url = new URL(patch.dnsUpstreamUrl);
    } catch {
      throw new SettingsValidationError(`invalid dnsUpstreamUrl: ${patch.dnsUpstreamUrl}`);
    }
    if (
      patch.dnsUpstreamUrl.length > 2048 ||
      url.protocol !== "https:" ||
      url.hostname === "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new SettingsValidationError("dnsUpstreamUrl must be an https URL without credentials, query or fragment");
    }
  }
  if (patch.dnsUpstreamCaPem !== undefined && patch.dnsUpstreamCaPem !== "") {
    if (patch.dnsUpstreamCaPem.length > MAX_CA_PEM_LENGTH || !matchesPattern(patch.dnsUpstreamCaPem.trim(), CA_PEM_PATTERN)) {
      throw new SettingsValidationError("dnsUpstreamCaPem must be PEM certificate(s) up to 16KB");
    }
  }
  if (patch.dnsFallbackServers !== undefined) {
    if (patch.dnsFallbackServers.length > MAX_FALLBACK_SERVERS) {
      throw new SettingsValidationError(`too many dnsFallbackServers (max ${MAX_FALLBACK_SERVERS})`);
    }
    for (const server of patch.dnsFallbackServers) {
      if (!isIpv4Address(server)) {
        throw new SettingsValidationError(`invalid IPv4 address in dnsFallbackServers: ${server}`);
      }
    }
  }
  if (patch.dnsClientNameServers !== undefined) {
    if (patch.dnsClientNameServers.length > MAX_CLIENT_NAME_SERVERS) {
      throw new SettingsValidationError(`too many dnsClientNameServers (max ${MAX_CLIENT_NAME_SERVERS})`);
    }
    for (const server of patch.dnsClientNameServers) {
      if (!isIpv4Address(server)) {
        throw new SettingsValidationError(`invalid IPv4 address in dnsClientNameServers: ${server}`);
      }
    }
  }
  if (patch.dnsRedirectExcludedCidrs !== undefined) {
    for (const cidr of patch.dnsRedirectExcludedCidrs) {
      if (!isIpv4Cidr(cidr)) {
        throw new SettingsValidationError(`invalid CIDR format in dnsRedirectExcludedCidrs: ${cidr}`);
      }
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
 * 失敗時の方針: `excludedDomains`がドメイン形式（`*.`付きも可）、`explicitProxyAllowedCidrs`がIPv4 CIDR形式、
 *              DNS中継の各項目が形式・項目間の整合を満たさない場合はSettingsValidationErrorを投げる
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
  validateDnsSettings(patch);
  const next: UserSettings = { ...getSettings(), ...patch };
  if (!next.transparentGatewayEnabled && !next.explicitProxyEnabled) {
    throw new SettingsValidationError("transparentGatewayEnabled or explicitProxyEnabled must be enabled");
  }
  // 項目間の整合（更新後の設定全体で確認する）。
  if (next.dnsRelayEnabled && next.dnsUpstreamUrl === "" && next.dnsFallbackServers.length === 0) {
    throw new SettingsValidationError("dnsRelayEnabled requires dnsUpstreamUrl or dnsFallbackServers");
  }
  if (next.dnsFailureMode === "fallback" && next.dnsFallbackServers.length === 0) {
    throw new SettingsValidationError("dnsFailureMode=fallback requires dnsFallbackServers");
  }
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}
