// 責務: 接続状態ダッシュボード画面の組み立てのみを行う。業務ロジック（コマンド解決等）は持たない
// （webserver/requirements.md「責務の範囲」参照）。API呼び出しは生成クライアント以外を使わない。

import { useEffect, useRef, useState } from "react";
import { useDashboardPolling, type ConnectionState } from "./hooks/useDashboardPolling";
import { ConnectionStatusCard } from "./components/dashboard/ConnectionStatusCard";
import { GatewayStatusCard } from "./components/dashboard/GatewayStatusCard";
import { LocationList } from "./components/dashboard/LocationList";
import { ConnectionActions, type SubmittingAction } from "./components/dashboard/ConnectionActions";
import { SessionCard } from "./components/dashboard/SessionCard";
import { DisconnectButton } from "./components/dashboard/DisconnectButton";
import { ConnectButton } from "./components/dashboard/ConnectButton";
import { ProviderSelector } from "./components/dashboard/ProviderSelector";
import { SettingsDialog } from "./components/dashboard/SettingsDialog";
import { ConnectionLogDialog } from "./components/dashboard/ConnectionLogDialog";
import { describeApiError, describeThrownError } from "./notifications/describe-api-error";
import { useToast } from "./notifications/ToastProvider";
import { putV1Connection } from "./generated/api/default/default";
import { useAvailableLocations } from "./hooks/useAvailableLocations";
import { useLocations } from "./hooks/useLocations";
import { findCurrentLocationId, resolveEffectiveId } from "./locations/current-location";
import { findCurrentAvailableLocation } from "./locations/current-available-location";
import { locationLabel } from "./locations/location-filter";
import { isAvailable, reasonOf, supportsLocationPing, usesAutoConnect } from "./capabilities/capability-state";

export function App() {
  // 利用者が接続先リストで明示的に選んだ接続先ID。未選択の間は、接続中なら現在の接続先、
  // 切断中なら最後に接続した接続先が対象になる（locations/current-location.ts）。
  const [selectedId, setSelectedId] = useState<string>();
  const [submitting, setSubmitting] = useState<SubmittingAction>();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  // ベンダーの切替中（切断を伴う。その間、接続操作を止める）。
  const [isSwitchingProvider, setIsSwitchingProvider] = useState(false);
  const { notifyError, notifySuccess } = useToast();
  const { data, isLoading, error: pollingError, refresh } = useDashboardPolling();
  // 操作の実行可否。最初の取得が終わるまで（data未取得）は接続先一覧を取得しない。取得に失敗しても
  // `capabilities`はundefinedのまま「制限しない」として扱う（判定できないことを理由に操作を塞がない）。
  const capabilities = data?.capabilities;
  // 選択中のベンダー。有効なベンダーが複数あるときだけ、画面へ選択部品とベンダー名を出す。
  const providers = data?.providers;
  const activeProvider = providers?.find((provider) => provider.active);
  const activeProviderId = activeProvider?.id;
  const activeProviderName = providers && providers.length > 1 ? activeProvider?.displayName : undefined;
  const locations = useLocations(data !== undefined && isAvailable(capabilities, "locationList"), activeProviderId);
  // 接続先リストがプラン制限で使えないときだけ、そのプランで接続できる国の参考一覧を取得する（プラン変更でも取得し直す）。
  const availableLocations = useAvailableLocations(
    data !== undefined && reasonOf(capabilities, "locationList") !== undefined,
    activeProviderId,
    data?.session?.plan?.id,
  );
  // ベンダーが替わったら、明示的に選んでいた接続先は前のベンダーのものなので消す。
  useEffect(() => {
    setSelectedId(undefined);
  }, [activeProviderId]);
  // 接続先を指定できず自動接続が使えるプロバイダ・プラン（接続先を選べないプラン等）では、［接続］は接続先を指定しない接続になる。
  const autoConnect = usesAutoConnect(capabilities);
  // 接続状態の取得が一時的に失敗しても操作ボタン（接続/切断）を使えるよう、最後に取得できた値を保持する
  // （失敗した事実は`error`として別途カードに表示する）。
  const lastConnection = useRef<ConnectionState>();
  if (data?.connection) {
    lastConnection.current = data.connection;
  }
  const connection = data?.connection ?? lastConnection.current;
  const error = pollingError ?? data?.connectionError;

  const currentId = findCurrentLocationId(connection, locations.locations);
  const lastConnectedId = locations.locations.find((location) => location.lastConnected)?.id;
  const targetId = resolveEffectiveId(selectedId, currentId, lastConnectedId, locations.locations);
  const target = locations.locations.find((location) => location.id === targetId);
  // 接続中で、対象が現在の接続先と異なるときだけ［接続先を変更］を出す。
  const canChange = connection?.status === "connected" && target !== undefined && target.id !== currentId;

  /**
   * 目的: 接続・接続先変更・切断のPUTを実行し、失敗はトースト、成功は状態を即時再取得する。
   * 入力: action("connect"=接続, "change"=接続中の接続先変更, "disconnect"=切断)。接続・変更は対象の接続先が必要。
   * 出力: なし。失敗時は`notifyError`で通知して終える（例外は投げない）。
   */
  async function handleSubmit(action: SubmittingAction): Promise<void> {
    const { operation, done } = {
      connect: { operation: "接続", done: "接続しました" },
      change: { operation: "接続先の変更", done: "接続先を変更しました" },
      disconnect: { operation: "切断", done: "切断しました" },
    }[action];
    const connecting = action !== "disconnect";
    if (connecting && !autoConnect && !target) {
      notifyError({ summary: "接続先を選択してください" });
      return;
    }
    setSubmitting(action);
    try {
      // 自動接続は接続先を指定せず（locationIdなし）に接続する。
      const body = !connecting ? { connect: false } : autoConnect || !target ? { connect: true } : { connect: true, locationId: target.id };
      const response = await putV1Connection(body);
      if (response.status !== 200) {
        notifyError(describeApiError(response.status, response.data, `${operation}に失敗しました`));
        // プラン制限（403）を学習した可能性があるため、実行可否を再取得して画面へ反映する。
        if (response.status === 403) refresh();
        return;
      }
      notifySuccess(done);
      if (connecting && target && !autoConnect) {
        // 以降の既定選択（次回の「前回」）を一覧へ即時反映し、明示的な選択は消して現在の接続先へ戻す。
        locations.markLastConnected(target.id);
        setSelectedId(undefined);
      }
      refresh();
    } catch (caughtError) {
      notifyError(describeThrownError(caughtError, `${operation}に失敗しました`));
    } finally {
      setSubmitting(undefined);
    }
  }

  return (
    <main>
      <header className="app-header">
        <h1>VPNGateway-GUI</h1>
        <div className="header-actions">
          <button type="button" onClick={() => setIsLogOpen(true)}>
            接続ログ
          </button>
          <button type="button" onClick={() => setIsSettingsOpen(true)}>
            設定
          </button>
        </div>
      </header>
      {providers ? (
        <section className="card" aria-label="VPNベンダー">
          <ProviderSelector
            providers={providers}
            connected={connection?.status === "connected"}
            onSwitched={refresh}
            onSwitchingChange={setIsSwitchingProvider}
            disabled={submitting !== undefined || isSwitchingProvider}
          />
        </section>
      ) : null}
      <ConnectionStatusCard connection={connection} isLoading={isLoading} error={error} providerName={activeProviderName} />
      <GatewayStatusCard gateway={data?.gateway} gatewayError={data?.gatewayError} isLoading={isLoading} />
      {/* ベンダーが替わったら、接続操作カード内のローカルな状態（絞り込み・タブ・ログインの入力・URL）を捨てるため、IDをkeyにして再マウントする。 */}
      <section key={activeProviderId} className="card controls" aria-label="接続操作">
        <SessionCard
          session={data?.session}
          capabilities={capabilities}
          onChanged={refresh}
          disconnectAction={
            connection?.status === "connected" ? (
              <DisconnectButton
                submitting={submitting === "disconnect"}
                capabilities={capabilities}
                disabled={isSwitchingProvider || (submitting !== undefined && submitting !== "disconnect")}
                onDisconnect={() => void handleSubmit("disconnect")}
              />
            ) : undefined
          }
          connectAction={
            connection && connection.status !== "connected" ? (
              <ConnectButton
                submitting={submitting === "connect"}
                hasTarget={autoConnect || target !== undefined}
                capabilities={capabilities}
                disabled={isSwitchingProvider || (submitting !== undefined && submitting !== "connect")}
                onConnect={() => void handleSubmit("connect")}
              />
            ) : undefined
          }
        />
        <LocationList
          locations={locations.locations}
          isLoading={locations.isLoading}
          isRefreshing={locations.isRefreshing}
          error={locations.error}
          selectedId={targetId}
          currentId={currentId}
          disabled={submitting !== undefined}
          onSelect={setSelectedId}
          onRefresh={locations.refresh}
          onToggleFavorite={(locationId, favorite) => void locations.setFavorite(locationId, favorite)}
          unavailableReason={reasonOf(capabilities, "locationList")}
          availableLocations={availableLocations}
          currentAvailableLocation={findCurrentAvailableLocation(connection, availableLocations)}
          availableLocationsShowPing={supportsLocationPing(capabilities)}
          favoritesDisabledReason={reasonOf(capabilities, "locationFavorites")}
          refreshDisabledReason={reasonOf(capabilities, "pingMeasurement")}
        />
        {target && !autoConnect ? (
          <p className="hint">
            選択中の接続先: {target.country.toUpperCase()} / {locationLabel(target)}
          </p>
        ) : null}
        <ConnectionActions
          connection={connection}
          submitting={submitting}
          canChange={canChange}
          capabilities={capabilities}
          disabled={isSwitchingProvider}
          onChange={() => void handleSubmit("change")}
        />
      </section>
      <SettingsDialog open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <ConnectionLogDialog open={isLogOpen} onClose={() => setIsLogOpen(false)} />
    </main>
  );
}
