// 責務: ダッシュボードが表示する「接続状態」「透過ゲートウェイ稼働状況」「ログイン状態」「操作ごとの実行可否」を、
// 1つの5秒ポーリングでまとめて取得する。
// API呼び出しは生成クライアントのみを使う。

import {
  getV1Connection,
  getV1ConnectionCapabilities,
  getV1ConnectionGateway,
  getV1Providers,
  getV1Session,
} from "../generated/api/default/default";
import type {
  GetV1Connection200,
  GetV1ConnectionCapabilities200,
  GetV1ConnectionGateway200,
  GetV1Providers200Item,
  GetV1Session200,
} from "../generated/api/endpoints.schemas";
import { usePolling } from "./usePolling";

export type ConnectionState = GetV1Connection200;
export type GatewayStatus = GetV1ConnectionGateway200;
export type SessionState = GetV1Session200;
export type ProviderItem = GetV1Providers200Item;
export type CapabilitiesState = GetV1ConnectionCapabilities200["capabilities"];

export interface DashboardState {
  // 各部分は独立に成否を持つ。片方の取得失敗で、もう片方の表示（および古い値の残存）に影響させないため。
  connection: ConnectionState | undefined;
  connectionError: string | undefined;
  gateway: GatewayStatus | undefined;
  gatewayError: string | undefined;
  // ログイン方式・ログイン状態・プラン。取得失敗時はundefined（ログイン導線は従来どおりの表示になる）。
  session: SessionState | undefined;
  // 操作ごとの実行可否。取得失敗時はundefined（判定できないことを理由に操作を塞がない）。
  capabilities: CapabilitiesState | undefined;
  // 有効なVPNベンダーの一覧（選択中・利用可否つき。Phase 11）。取得失敗時はundefined（選択部品を出さず従来どおり動作する）。
  providers: ProviderItem[] | undefined;
}

/**
 * 目的: 1回のポーリングで、APIレスポンス（成功/非200/通信失敗）を「値かエラー文言のどちらか」へ正規化する。
 * 入力: request(生成クライアントの呼び出し), failureMessage(非200時の文言を作る関数。引数はHTTPステータス)。
 * 出力: 成功なら`{ value }`、失敗なら`{ error }`。throwしない。
 */
async function settle<T>(
  request: () => Promise<{ status: number; data: unknown }>,
  failureMessage: (status: number) => string,
): Promise<{ value: T; error: undefined } | { value: undefined; error: string }> {
  try {
    const response = await request();
    return response.status === 200
      ? { value: response.data as T, error: undefined }
      : { value: undefined, error: failureMessage(response.status) };
  } catch (caughtError) {
    return { value: undefined, error: caughtError instanceof Error ? caughtError.message : String(caughtError) };
  }
}

/**
 * 目的: 接続状態・稼働状況・ログイン状態・操作の実行可否・有効なベンダーの一覧を並行取得する。
 * 入力: なし。
 * 出力: DashboardState。失敗はthrowせず、接続状態・稼働状況はエラー文言（connectionError/gatewayError）へ格納する。
 *       ログイン状態・実行可否は、失敗時に値をundefinedにするだけで、利用者向けのエラーは出さない
 *       （補助情報であり、取得できなくても操作は従来どおり行えるため）。
 */
async function fetchDashboardState(): Promise<DashboardState> {
  const [connection, gateway, session, capabilities, providers] = await Promise.all([
    settle<ConnectionState>(
      () => getV1Connection(),
      (status) => `接続状態の取得に失敗しました (status: ${status})`,
    ),
    settle<GatewayStatus>(
      () => getV1ConnectionGateway(),
      (status) => `稼働状況の取得に失敗しました (status: ${status})`,
    ),
    settle<SessionState>(
      () => getV1Session(),
      (status) => `ログイン状態の取得に失敗しました (status: ${status})`,
    ),
    settle<GetV1ConnectionCapabilities200>(
      () => getV1ConnectionCapabilities(),
      (status) => `操作の実行可否の取得に失敗しました (status: ${status})`,
    ),
    settle<ProviderItem[]>(
      () => getV1Providers(),
      (status) => `ベンダー一覧の取得に失敗しました (status: ${status})`,
    ),
  ]);
  return {
    connection: connection.value,
    connectionError: connection.error,
    gateway: gateway.value,
    gatewayError: gateway.error,
    session: session.value,
    capabilities: capabilities.value?.capabilities,
    providers: providers.value,
  };
}

/**
 * 目的: ダッシュボード表示用の状態を5秒間隔で取得するフック。
 * 入力: intervalMs(ポーリング間隔。省略時は`usePolling`の既定5000ms)。
 * 出力: 最新のDashboardState・ローディング状態・エラーメッセージ・即時再取得関数。
 * 例: const { data, refresh } = useDashboardPolling();
 */
export function useDashboardPolling(intervalMs?: number) {
  return usePolling(() => fetchDashboardState(), intervalMs);
}
