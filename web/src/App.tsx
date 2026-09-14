// 責務: 接続状態ダッシュボード画面の組み立てのみを行う。業務ロジック（コマンド解決等）は持たない
// （webserver/requirements.md「責務の範囲」参照）。API呼び出しは生成クライアント以外を使わない。

import { useEffect, useState } from "react";
import { useConnectionPolling } from "./hooks/useConnectionPolling";
import { ConnectionStatusCard } from "./components/dashboard/ConnectionStatusCard";
import { CountrySelect } from "./components/dashboard/CountrySelect";
import { ConnectDisconnectButton } from "./components/dashboard/ConnectDisconnectButton";
import { VpnLoginButton } from "./components/dashboard/VpnLoginButton";
import { SettingsDialog } from "./components/dashboard/SettingsDialog";
import {
  getV1Connection,
  putV1Connection,
  getV1ConnectionCountries,
} from "./generated/api/default/default";

export function App() {
  const [countries, setCountries] = useState<string[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const { connection, isLoading, error, refresh } = useConnectionPolling(async () => {
    const response = await getV1Connection();
    if (response.status !== 200) {
      throw new Error(`接続状態の取得に失敗しました (status: ${response.status})`);
    }
    return response.data;
  });

  useEffect(() => {
    getV1ConnectionCountries().then((response) => {
      if (response.status === 200) {
        setCountries(response.data);
      }
    });
  }, []);

  async function handleConnect(): Promise<void> {
    if (!selectedCountry) {
      setActionError("接続国を選択してください");
      return;
    }
    setIsSubmitting(true);
    setActionError(undefined);
    try {
      const response = await putV1Connection({ connect: true, country: selectedCountry });
      if (response.status !== 200) {
        const message = "message" in response.data ? response.data.message : undefined;
        throw new Error(message ?? `接続に失敗しました (status: ${response.status})`);
      }
      refresh();
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDisconnect(): Promise<void> {
    setIsSubmitting(true);
    setActionError(undefined);
    try {
      const response = await putV1Connection({ connect: false });
      if (response.status !== 200) {
        const message = "message" in response.data ? response.data.message : undefined;
        throw new Error(message ?? `切断に失敗しました (status: ${response.status})`);
      }
      refresh();
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <h1>VPNGateway-GUI</h1>
      <ConnectionStatusCard connection={connection} isLoading={isLoading} error={error} />
      <button type="button" onClick={() => setIsSettingsOpen(true)}>
        設定
      </button>
      <SettingsDialog open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} countries={countries} />
      <VpnLoginButton />
      <CountrySelect
        countries={countries}
        value={selectedCountry}
        onChange={setSelectedCountry}
        disabled={isSubmitting}
      />
      <ConnectDisconnectButton
        connection={connection}
        isSubmitting={isSubmitting}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />
      {actionError ? <p role="alert">{actionError}</p> : null}
    </main>
  );
}
