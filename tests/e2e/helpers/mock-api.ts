// 責務: 実ブラウザのテスト用に、APIサーバの応答をブラウザ側（`page.route`）で再現する。
// 利用者アカウント・ログイン状態・接続状態・ベンダー・設定・動作検証を、メモリ上の状態として持ち、受け取った要求を記録する。

import type { Page, Route } from "playwright/test";

export interface MockApiOptions {
  /** 初期状態でアカウントが作成済みか。 */
  configured?: boolean;
  /** 初期状態でログイン済みか。 */
  authenticated?: boolean;
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

export interface MockApi {
  calls: RecordedCall[];
  state: {
    configured: boolean;
    authenticated: boolean;
    connection: Record<string, unknown>;
    activeProvider: string;
    config: Record<string, unknown>;
  };
}

const OK = { available: true };

const LOCATIONS: Record<string, Array<Record<string, unknown>>> = {
  adguardvpn: [
    { id: "jp-tokyo", country: "jp", countryName: "Japan", city: "Tokyo", pingMs: 4, favorite: false, lastConnected: false },
    { id: "us-las-vegas", country: "us", countryName: "United States", city: "Las Vegas", pingMs: 111, favorite: false, lastConnected: false },
  ],
  protonvpn: [{ id: "de-germany", country: "de", countryName: "Germany", favorite: false, lastConnected: false }],
};

/**
 * 目的: ページへ、APIサーバの代役を設定する。
 * 入力: page(Playwrightのページ), options(初期状態)。
 * 出力: 記録した要求と、利用者・接続・設定の現在の状態。
 */
export async function installMockApi(page: Page, options: MockApiOptions = {}): Promise<MockApi> {
  const api: MockApi = {
    calls: [],
    state: {
      configured: options.configured ?? true,
      authenticated: options.authenticated ?? true,
      connection: { status: "disconnected" },
      activeProvider: "adguardvpn",
      config: {
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
        verifyEchoUrl: "https://echo.example",
      },
    },
  };
  let verificationPolls = 0;

  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  // 開発サーバが配信するモジュール（/src/generated/api/...）を巻き込まないよう、APIのパス（/api/v1/）だけを対象にする。
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    const text = request.postData();
    const body: unknown = text ? JSON.parse(text) : undefined;
    api.calls.push({ method, path, body });
    const { state } = api;
    const key = `${method} ${path}`;

    // 利用者の認証。アカウントの状態確認・初回作成・ログイン以外は、ログイン済みでなければ401にする。
    if (key === "GET /v1/operator") return json(route, 200, { configured: state.configured, ...(state.authenticated ? { username: "admin" } : {}) });
    if (key === "POST /v1/operator") {
      state.configured = true;
      state.authenticated = true;
      return json(route, 200, { configured: true, username: "admin" });
    }
    if (key === "POST /v1/operator/session") {
      state.authenticated = true;
      return json(route, 200, { authenticated: true });
    }
    if (!state.authenticated) return json(route, 401, { error: "unauthenticated" });
    if (key === "GET /v1/operator/session") return json(route, 200, { authenticated: true });
    if (key === "DELETE /v1/operator/session") {
      state.authenticated = false;
      return json(route, 200, { authenticated: false });
    }

    // ダッシュボード。
    if (key === "GET /v1/connection") return json(route, 200, state.connection);
    if (key === "PUT /v1/connection") {
      const payload = body as { connect: boolean; locationId?: string };
      state.connection = payload.connect
        ? { status: "connected", country: payload.locationId?.slice(0, 2), location: payload.locationId?.includes("tokyo") ? "TOKYO" : "LAS VEGAS", locationId: payload.locationId }
        : { status: "disconnected" };
      return json(route, 200, state.connection);
    }
    if (key === "GET /v1/connection/gateway") {
      return json(route, 200, {
        transparentGateway: { state: "active", vpnInterface: "tun0", killSwitchBlocking: false },
        explicitProxy: { state: "stopped", restartCount: 0 },
      });
    }
    if (key === "GET /v1/connection/capabilities") {
      return json(route, 200, {
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
        },
      });
    }
    if (key === "GET /v1/connection/locations") return json(route, 200, LOCATIONS[state.activeProvider] ?? []);
    if (key === "GET /v1/connection/available-locations") return json(route, 200, { locations: [] });
    if (key === "GET /v1/providers") {
      return json(route, 200, [
        { id: "adguardvpn", displayName: "AdGuard VPN", active: state.activeProvider === "adguardvpn", available: true },
        { id: "protonvpn", displayName: "Proton VPN", active: state.activeProvider === "protonvpn", available: true },
      ]);
    }
    if (key === "PUT /v1/providers/active") {
      state.activeProvider = (body as { providerId: string }).providerId;
      state.connection = { status: "disconnected" };
      return json(route, 200, { id: state.activeProvider, displayName: state.activeProvider === "protonvpn" ? "Proton VPN" : "AdGuard VPN" });
    }
    if (key === "GET /v1/session") return json(route, 200, { loginMethod: "deviceUrl", loggedIn: true, plan: { id: "free", label: "Free" } });
    if (key === "GET /v1/connection/config") return json(route, 200, state.config);
    if (key === "PUT /v1/connection/config") {
      state.config = body as Record<string, unknown>;
      return json(route, 200, state.config);
    }
    if (key === "GET /v1/connection/log") return json(route, 200, []);

    // 設定の動作検証。2回目の取得で完了する。
    if (key === "POST /v1/verifications") {
      verificationPolls = 0;
      return json(route, 202, verification("running"));
    }
    if (method === "GET" && path.startsWith("/v1/verifications/")) {
      verificationPolls += 1;
      return json(route, 200, verification(verificationPolls >= 2 ? "completed" : "running"));
    }
    if (method === "PUT" && path.endsWith("/client-observations/egress-ip")) return json(route, 200, { accepted: true });
    return json(route, 404, { error: "not_found", path });
  });
  return api;
}

/** 目的: 動作検証の応答を作る（完了時は全項目が合格）。 */
function verification(state: "running" | "completed") {
  const done = state === "completed";
  return {
    id: "22222222-2222-2222-2222-222222222222",
    state,
    startedAt: "2026-10-25T00:00:00.000Z",
    clientProbe: { dnsName: "vpngw-0123456789abcdef.example.com" },
    checks: [
      { id: "gateway-rules", title: "透過ゲートウェイの構成", group: "config", status: done ? "pass" : "running" },
      { id: "tunnel-egress", title: "VPN トンネルの出口 IP", group: "gateway", status: done ? "pass" : "pending", ...(done ? { observed: "203.0.113.9" } : {}) },
      { id: "client-egress", title: "この端末の出口 IP", group: "client", status: done ? "pass" : "pending" },
    ],
  };
}
