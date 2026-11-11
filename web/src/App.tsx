// 責務: 接続状態ダッシュボード画面の組み立てのみを行う。業務ロジック（コマンド解決等）は持たない
// API呼び出しは生成クライアント以外を使わない。

import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboardPolling, type ConnectionState } from "./hooks/useDashboardPolling";
import { ConnectionStatusCard, connectionCardClassName } from "./components/dashboard/ConnectionStatusCard";
import { GatewayStatusCard } from "./components/dashboard/GatewayStatusCard";
import { LocationList } from "./components/dashboard/LocationList";
import { LocationBrowser } from "./components/dashboard/LocationBrowser";
import { ConnectionActions, type SubmittingAction } from "./components/dashboard/ConnectionActions";
import { SessionCard } from "./components/dashboard/SessionCard";
import { DisconnectButton } from "./components/dashboard/DisconnectButton";
import { ConnectButton } from "./components/dashboard/ConnectButton";
import { ProviderSelector } from "./components/dashboard/ProviderSelector";
import { SettingsDialog } from "./components/dashboard/SettingsDialog";
import { ConnectionLogDialog } from "./components/dashboard/ConnectionLogDialog";
import { GithubIcon } from "./components/icons/GithubIcon";
import { ThemeToggleButton } from "./components/theme/ThemeToggleButton";
import { HorizontalScroll } from "./components/HorizontalScroll";
import { describeApiError, describeThrownError } from "./notifications/describe-api-error";
import { useToast } from "./notifications/ToastProvider";
import {
  deleteV1ConnectionLocationsLocationIdFavorite,
  getV1ConnectionFavorites,
  putV1Connection,
  putV1ConnectionLocationsLocationIdFavorite,
} from "./generated/api/default/default";
import type { GetV1ConnectionFavorites200Item, PutV1ConnectionLocationsLocationIdFavoriteBody } from "./generated/api/endpoints.schemas";
import { useCityList } from "./hooks/useCityList";
import { useServerList } from "./hooks/useServerList";
import { useCityTab } from "./hooks/useCityTab";
import { toServerLocationId } from "./locations/server-location-id";
import { useAvailableLocations } from "./hooks/useAvailableLocations";
import { useLocations } from "./hooks/useLocations";
import { findCurrentLocationId } from "./locations/current-location";
import { findCurrentAvailableLocation } from "./locations/current-available-location";
import { isAvailable, reasonOf, supportsLocationPing, usesAutoConnect } from "./capabilities/capability-state";

interface Props {
  // ログアウト操作（Phase 25）。認証状態はApp自身が持たず（責務外）、呼び出し元（Root.tsx）から
  // ハンドラを受け取るだけにする。未指定（既存のApp単体テスト等）ではログアウトボタンを出さない。
  onLogout?: () => void;
}

export function App({ onLogout }: Props) {
  // 利用者が接続先リストで明示的に選んだ接続先ID。未選択の間は、接続中なら現在の接続先、
  // 切断中なら最後に接続した接続先が対象になる（locations/current-location.ts）。
  const [selectedId, setSelectedId] = useState<string>();
  // 階層の画面で開いている国と都市（未選択は空）。都市とサーバの一覧の取得対象になる。
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedCityId, setSelectedCityId] = useState("");
  const [favorites, setFavorites] = useState<GetV1ConnectionFavorites200Item[]>([]);
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
    setSelectedCountry("");
    setSelectedCityId("");
  }, [activeProviderId]);
  const cityList = useCityList(selectedCountry);
  const serverList = useServerList(selectedCityId, data?.connection?.status, data?.connection?.location);
  const cityTab = useCityTab();
  // お気に入りの一覧（都市とサーバ）。登録・解除のたびに取り直す。
  const loadFavorites = useCallback(async () => {
    try {
      const response = await getV1ConnectionFavorites();
      if (response.status === 200) setFavorites(response.data);
    } catch {
      // 取得に失敗しても、お気に入りのタブが空になるだけで、他の操作は続けられる。
    }
  }, []);
  useEffect(() => {
    if (!isAvailable(capabilities, "locationList")) return;
    void loadFavorites();
  }, [activeProviderId, capabilities, loadFavorites]);
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

  // 接続操作カードは、接続先リストまたは参考一覧に実際に表示する項目があるときだけ画面の残り高さいっぱいに
  // 広げる。取得中・0件・制限理由のみ（参考一覧も空）のときは、内容に必要な高さのみを占める（Phase 22）。
  const hasVisibleList = locations.locations.length > 0 || availableLocations.length > 0;

  // 現在の接続先（接続中のみ）。都市名の突き合わせには、開いている国の都市の一覧を使う。
  const currentId = findCurrentLocationId(connection, cityList.cities);
  // 接続ボタンの対象は、利用者が選んだ接続先。選んでいなければ現在の接続先。
  const targetId = selectedId ?? currentId;
  const target = targetId === undefined ? undefined : { id: targetId };
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
      // サーバお気に入りが接続時に削除された場合は、無通知のフォールバックとして扱う。
      let silent = connecting && !autoConnect && favorites.some((item) => item.id === target?.id && item.kind === "server");
      if (silent) {
        try {
          const updated = await getV1ConnectionFavorites();
          if (updated.status === 200) {
            setFavorites(updated.data);
            silent = !updated.data.some((item) => item.id === target?.id);
          }
        } catch {
          // 接続は成功済み。判定用の再取得失敗を接続失敗として通知しない。
        }
      }
      if (!silent) notifySuccess(done);
      if (connecting && target && !autoConnect) {
        // 以降の既定選択（次回の「前回」）を一覧へ即時反映し、明示的な選択は消して現在の接続先へ戻す。
        if (selectedCountry) locations.markLastConnected(selectedCountry);
        setSelectedId(undefined);
      }
      refresh();
    } catch (caughtError) {
      notifyError(describeThrownError(caughtError, `${operation}に失敗しました`));
    } finally {
      setSubmitting(undefined);
    }
  }

  /**
   * 目的: 都市のお気に入りを登録（PUT）または解除（DELETE）し、成功したら☆の表示とお気に入りの一覧を直す。
   * 入力: cityId(対象の都市ID), favorite(真なら登録、偽なら解除)。都市の一覧に無い都市は何もしない。
   * 出力: なし。失敗時は通知する（例外は投げない）。
   */
  async function toggleCityFavorite(cityId: string, favorite: boolean): Promise<void> {
    const city = cityList.cities.find((item) => item.id === cityId);
    if (!city) return;
    await setFavoriteItem(cityId, favorite, { id: city.id, kind: "city", country: city.country, countryName: city.countryName, city: city.city }, () => cityList.patchFavorite(cityId, favorite));
  }

  /**
   * 目的: 選んだ都市のサーバのお気に入りを登録または解除する（サーバの接続先IDはサーバ名から作る）。
   * 入力: serverName(サーバ名), favorite(真なら登録、偽なら解除)。都市が未選択なら何もしない。
   * 出力: なし。失敗時は通知する（例外は投げない）。
   */
  async function toggleServerFavorite(serverName: string, favorite: boolean): Promise<void> {
    const city = cityList.cities.find((item) => item.id === selectedCityId);
    if (!city) return;
    const locationId = toServerLocationId(serverName);
    await setFavoriteItem(locationId, favorite, { id: locationId, kind: "server", country: city.country, countryName: city.countryName, city: city.city, serverName }, () => serverList.patchFavorite(serverName, favorite));
  }

  /**
   * 目的: お気に入りの登録（PUT）・解除（DELETE）の共通処理。成功したら画面の☆とお気に入りの一覧を直す。
   * 入力: locationId(接続先ID), favorite(真なら登録), body(登録時の本文), patch(成功後に一覧の☆を直す処理)。
   * 出力: なし。失敗時は要約をトーストに出し、表示は変えない。
   */
  async function setFavoriteItem(
    locationId: string,
    favorite: boolean,
    body: PutV1ConnectionLocationsLocationIdFavoriteBody,
    patch: () => void,
  ): Promise<void> {
    const operation = favorite ? "お気に入りへの追加" : "お気に入りの解除";
    try {
      const response = favorite
        ? await putV1ConnectionLocationsLocationIdFavorite(locationId, body)
        : await deleteV1ConnectionLocationsLocationIdFavorite(locationId);
      if (response.status !== 200) {
        notifyError(describeApiError(response.status, response.data, `${operation}に失敗しました`));
        return;
      }
      patch();
      await loadFavorites();
    } catch (caughtError) {
      notifyError(describeThrownError(caughtError, `${operation}に失敗しました`));
    }
  }

  return (
    <main>
      <header className="app-header">
        <h1>VPNGateway-GUI</h1>
        <HorizontalScroll className="header-actions">
          <ThemeToggleButton />
          <button type="button" onClick={() => setIsLogOpen(true)}>
            接続ログ
          </button>
          <button type="button" onClick={() => setIsSettingsOpen(true)}>
            設定
          </button>
          {onLogout ? (
            <button type="button" onClick={onLogout}>
              ログアウト
            </button>
          ) : null}
        </HorizontalScroll>
      </header>
      {/* ベンダーが替わったら、ログイン導線のローカルな状態（入力中のフォーム・URL提示の結果）を捨てるため、IDをkeyにして再マウントする。 */}
      <section key={`provider-${activeProviderId}`} className="card provider-card" aria-label="VPNベンダー">
        {providers ? (
          <ProviderSelector
            providers={providers}
            connected={connection?.status === "connected"}
            onSwitched={refresh}
            onSwitchingChange={setIsSwitchingProvider}
            disabled={submitting !== undefined || isSwitchingProvider}
          />
        ) : null}
        <SessionCard session={data?.session} capabilities={capabilities} onChanged={refresh} />
      </section>
      <section className={connectionCardClassName(connection, isLoading, error)} aria-label="接続状態">
        <div className="status-top-row">
          {connection?.status === "connected" ? (
            <DisconnectButton
              submitting={submitting === "disconnect"}
              capabilities={capabilities}
              disabled={isSwitchingProvider || (submitting !== undefined && submitting !== "disconnect")}
              onDisconnect={() => void handleSubmit("disconnect")}
            />
          ) : null}
          {connection && connection.status !== "connected" ? (
            <ConnectButton
              submitting={submitting === "connect"}
              hasTarget={autoConnect || target !== undefined}
              capabilities={capabilities}
              disabled={isSwitchingProvider || (submitting !== undefined && submitting !== "connect")}
              onConnect={() => void handleSubmit("connect")}
            />
          ) : null}
          <ConnectionStatusCard connection={connection} isLoading={isLoading} error={error} providerName={activeProviderName} />
        </div>
        <GatewayStatusCard gateway={data?.gateway} gatewayError={data?.gatewayError} isLoading={isLoading} />
      </section>
      {/* ベンダーが替わったら、接続操作カード内のローカルな状態（絞り込み・タブ）を捨てるため、IDをkeyにして再マウントする。 */}
      <section key={activeProviderId} className={`card controls${hasVisibleList ? " controls-expanded" : ""}`} aria-label="接続操作">
        {reasonOf(capabilities, "locationList") || locations.error ? (
          <LocationList
            locations={[]}
            isLoading={locations.isLoading}
            isRefreshing={locations.isRefreshing}
            error={locations.error}
            selectedId={undefined}
            currentId={undefined}
            disabled={submitting !== undefined}
            onSelect={() => undefined}
            onRefresh={locations.refresh}
            onToggleFavorite={() => undefined}
            unavailableReason={reasonOf(capabilities, "locationList")}
            availableLocations={availableLocations}
            currentAvailableLocation={findCurrentAvailableLocation(connection, availableLocations)}
            availableLocationsShowPing={supportsLocationPing(capabilities)}
            favoritesDisabledReason={reasonOf(capabilities, "locationFavorites")}
            refreshDisabledReason={reasonOf(capabilities, "pingMeasurement")}
            changeAction={
              <ConnectionActions
              connection={connection}
              submitting={submitting}
              canChange={canChange}
              capabilities={capabilities}
              disabled={isSwitchingProvider}
              onChange={() => void handleSubmit("change")}
            />
            }
          />
        ) : (
          <>
            <LocationBrowser
              countries={locations.locations}
              favorites={favorites}
              cities={cityList.cities}
              servers={serverList.servers}
              isLoading={cityList.isLoading}
              isRefreshing={cityList.isRefreshing}
              cityError={cityList.error}
              cityTab={cityTab.tab}
              hasServerSelection={locations.locations.find((item) => item.country === selectedCountry)?.hasServerStage ?? false}
              disabled={submitting !== undefined}
              selectedId={targetId}
              currentId={currentId}
              onSelect={setSelectedId}
              onToggleCityFavorite={(cityId, favorite) => void toggleCityFavorite(cityId, favorite)}
              onToggleServerFavorite={(serverName, favorite) => void toggleServerFavorite(serverName, favorite)}
              onRefresh={() => void (cityList.error ? cityList.refresh() : cityList.remeasure().then((success) => { if (success) locations.refresh(); }))}
              onCityTabChange={(tab) => void cityTab.save(tab)}
              onCountryChange={(country) => { setSelectedCountry(country ?? ""); setSelectedCityId(""); setSelectedId(undefined); }}
              onCityChange={(cityId) => { setSelectedCityId(cityId ?? ""); }}
            />
            <ConnectionActions
              connection={connection}
              submitting={submitting}
              canChange={canChange}
              capabilities={capabilities}
              disabled={isSwitchingProvider}
              onChange={() => void handleSubmit("change")}
            />
          </>
        )}
      </section>
      <SettingsDialog open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} defaultExplicitProxyAllowedCidr={data?.gateway?.lanCidr} />
      <ConnectionLogDialog open={isLogOpen} onClose={() => setIsLogOpen(false)} />
      <footer className="app-footer">
        <a href="https://github.com/nekono-dev/vpngateway-gui" target="_blank" rel="noreferrer">
          <GithubIcon />
          GitHub
        </a>
      </footer>
    </main>
  );
}
