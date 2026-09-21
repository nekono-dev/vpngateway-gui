// 責務: 接続状態ダッシュボード画面の組み立てのみを行う。業務ロジック（コマンド解決等）は持たない
// （webserver/requirements.md「責務の範囲」参照）。API呼び出しは生成クライアント以外を使わない。

import { useRef, useState } from "react";
import { useDashboardPolling, type ConnectionState } from "./hooks/useDashboardPolling";
import { ConnectionStatusCard } from "./components/dashboard/ConnectionStatusCard";
import { GatewayStatusCard } from "./components/dashboard/GatewayStatusCard";
import { LocationList } from "./components/dashboard/LocationList";
import { ConnectionActions, type SubmittingAction } from "./components/dashboard/ConnectionActions";
import { VpnLoginButton } from "./components/dashboard/VpnLoginButton";
import { SettingsDialog } from "./components/dashboard/SettingsDialog";
import { ConnectionLogDialog } from "./components/dashboard/ConnectionLogDialog";
import { describeApiError, describeThrownError } from "./notifications/describe-api-error";
import { useToast } from "./notifications/ToastProvider";
import { putV1Connection } from "./generated/api/default/default";
import { useLocations } from "./hooks/useLocations";
import { findCurrentLocationId, resolveEffectiveId } from "./locations/current-location";

export function App() {
  // 利用者が接続先リストで明示的に選んだ接続先ID。未選択の間は、接続中なら現在の接続先、
  // 切断中なら最後に接続した接続先が対象になる（locations/current-location.ts）。
  const [selectedId, setSelectedId] = useState<string>();
  const [submitting, setSubmitting] = useState<SubmittingAction>();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const { notifyError, notifySuccess } = useToast();
  const locations = useLocations();

  const { data, isLoading, error: pollingError, refresh } = useDashboardPolling();
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
    if (connecting && !target) {
      notifyError({ summary: "接続先を選択してください" });
      return;
    }
    setSubmitting(action);
    try {
      const response = await putV1Connection(connecting && target ? { connect: true, locationId: target.id } : { connect: false });
      if (response.status !== 200) {
        notifyError(describeApiError(response.status, response.data, `${operation}に失敗しました`));
        return;
      }
      notifySuccess(done);
      if (connecting && target) {
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
      <ConnectionStatusCard connection={connection} isLoading={isLoading} error={error} />
      <GatewayStatusCard gateway={data?.gateway} gatewayError={data?.gatewayError} isLoading={isLoading} />
      <section className="card controls" aria-label="接続操作">
        <VpnLoginButton />
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
        />
        {target ? (
          <p className="hint">
            選択中の接続先: {target.country.toUpperCase()} / {target.city}
          </p>
        ) : null}
        <ConnectionActions
          connection={connection}
          submitting={submitting}
          hasTarget={target !== undefined}
          canChange={canChange}
          onConnect={() => void handleSubmit("connect")}
          onChange={() => void handleSubmit("change")}
          onDisconnect={() => void handleSubmit("disconnect")}
        />
      </section>
      <SettingsDialog open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <ConnectionLogDialog open={isLogOpen} onClose={() => setIsLogOpen(false)} />
    </main>
  );
}
