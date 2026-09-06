// 責務: 接続/切断ボタンの表示と二重送信防止のみを行う（webserver/requirements.md「状態管理の要件」参照）。

import type { ConnectionState } from "../../hooks/useConnectionPolling";

interface Props {
  connection: ConnectionState | undefined;
  isSubmitting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function ConnectDisconnectButton({ connection, isSubmitting, onConnect, onDisconnect }: Props) {
  const isConnected = connection?.status === "connected";

  return (
    <button
      type="button"
      disabled={isSubmitting || !connection}
      onClick={() => (isConnected ? onDisconnect() : onConnect())}
    >
      {isSubmitting ? "処理中..." : isConnected ? "切断" : "接続"}
    </button>
  );
}
