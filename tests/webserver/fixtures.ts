// 責務: Webサーバの画面の受け入れテスト共通のデータと、生成APIクライアントのモックの既定値。
// テストごとに `vi.hoisted` で作ったモックの集合へ、ダッシュボードが取得する全てのAPIの既定の応答を設定する。

import type { Mock } from "vitest";

/** 画面が呼ぶ生成APIクライアントの関数名の一覧（モックの対象）。 */
export const API_FUNCTION_NAMES = [
  "getV1Operator",
  "getV1OperatorSession",
  "deleteV1OperatorSession",
  "postV1Operator",
  "postV1OperatorSession",
  "putV1Operator",
  "getV1Connection",
  "putV1Connection",
  "getV1ConnectionLocations",
  "putV1ConnectionLocationsLocationIdFavorite",
  "deleteV1ConnectionLocationsLocationIdFavorite",
  "getV1ConnectionGateway",
  "getV1ConnectionCapabilities",
  "getV1ConnectionAvailableLocations",
  "getV1Providers",
  "putV1ProvidersActive",
  "getV1Session",
  "postV1Session",
  "deleteV1Session",
  "getV1ConnectionConfig",
  "putV1ConnectionConfig",
  "getV1ConnectionLog",
  "postV1Verifications",
  "getV1VerificationsId",
  "putV1VerificationsIdClientObservationsEgressIp",
  "postV1GatewayReboot",
] as const;

export type ApiMocks = Record<(typeof API_FUNCTION_NAMES)[number], Mock>;

/** 目的: 生成APIクライアントの関数の名前ごとに、空のモックを作る（`vi.hoisted` から呼ぶ）。 */
export function createApiMocks(createMock: () => Mock): ApiMocks {
  return Object.fromEntries(API_FUNCTION_NAMES.map((name) => [name, createMock()])) as ApiMocks;
}

export const OK = { available: true };

/** 目的: 全ての操作が可の実行可否の応答を返す。個別の操作だけ上書きできる。 */
export function capabilities(overrides: Record<string, { available: boolean; reason?: string; message?: string }> = {}) {
  return {
    status: 200,
    data: {
      capabilities: {
        login: OK,
        logout: OK,
        connectToLocation: OK,
        connectAuto: { available: false, reason: "unsupported", message: "このVPNプロバイダでは利用できません" },
        changeLocation: OK,
        disconnect: OK,
        locationList: OK,
        locationFavorites: OK,
        pingMeasurement: OK,
        ...overrides,
      },
    },
  };
}

export const provider = (id: string, displayName: string, extra: Record<string, unknown> = {}) => ({
  id,
  displayName,
  active: false,
  available: true,
  ...extra,
});

export const location = (id: string, country: string, countryName: string, city: string, pingMs: number, extra: Record<string, unknown> = {}) => ({
  id,
  country,
  countryName,
  city,
  pingMs,
  favorite: false,
  lastConnected: false,
  ...extra,
});

export const LOCATIONS = [
  location("jp-tokyo", "jp", "Japan", "Tokyo", 4),
  location("kr-seoul", "kr", "South Korea", "Seoul", 28),
  location("us-las-vegas", "us", "United States", "Las Vegas", 111),
];

export const gatewayStatus = {
  status: 200,
  data: {
    transparentGateway: { state: "active", vpnInterface: "tun0", killSwitchBlocking: false },
    explicitProxy: { state: "stopped", restartCount: 0 },
  },
};

export const defaultConfig = {
  killSwitch: true,
  excludedDomains: [],
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
  verifyEchoUrl: "https://api.ipify.org",
};

/**
 * 目的: ダッシュボードが取得する全てのAPIに、既定の応答（切断中・全操作が可・1つのベンダー）を設定する。
 * 入力: api（`createApiMocks` の戻り値）。
 */
export function installDashboardDefaults(api: ApiMocks): void {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.getV1Operator.mockResolvedValue({ status: 200, data: { configured: true, username: "admin" } });
  api.getV1OperatorSession.mockResolvedValue({ status: 200, data: { authenticated: true } });
  api.getV1Connection.mockResolvedValue({ status: 200, data: { status: "disconnected" } });
  api.getV1ConnectionGateway.mockResolvedValue(gatewayStatus);
  api.getV1ConnectionLocations.mockResolvedValue({ status: 200, data: LOCATIONS });
  api.getV1ConnectionCapabilities.mockResolvedValue(capabilities());
  api.getV1ConnectionAvailableLocations.mockResolvedValue({ status: 200, data: { locations: [] } });
  api.getV1Providers.mockResolvedValue({ status: 200, data: [provider("adguardvpn", "AdGuard VPN", { active: true })] });
  api.getV1Session.mockResolvedValue({ status: 200, data: { loginMethod: "deviceUrl", loggedIn: true, plan: { id: "free", label: "Free" } } });
  api.getV1ConnectionConfig.mockResolvedValue({ status: 200, data: defaultConfig });
  api.getV1ConnectionLog.mockResolvedValue({ status: 200, data: [] });
}
