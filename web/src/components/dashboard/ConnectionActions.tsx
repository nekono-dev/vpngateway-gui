// 責務: 接続／切断／「接続先を変更」ボタンの出し分けと二重送信防止（送信中は全ボタンを無効化）のみを行う
// （webserver/requirements.md「接続先リスト」、design.md「選択・ボタンの状態遷移」）。何を接続先とするかの決定は親が行う。

import type { ConnectionState } from "../../hooks/useDashboardPolling";

export type SubmittingAction = "connect" | "change" | "disconnect";

interface Props {
  connection: ConnectionState | undefined;
  // 実行中の操作。undefinedなら待機中。
  submitting: SubmittingAction | undefined;
  // 接続・変更の対象となる接続先があるか。無ければ［接続］を押せない。
  hasTarget: boolean;
  // 接続中で、対象が現在の接続先と異なるか。真のときだけ［接続先を変更］を表示する。
  canChange: boolean;
  onConnect: () => void;
  onChange: () => void;
  onDisconnect: () => void;
}

export function ConnectionActions({ connection, submitting, hasTarget, canChange, onConnect, onChange, onDisconnect }: Props) {
  const isBusy = submitting !== undefined;

  if (connection?.status === "connected") {
    return (
      <div className="connect-row">
        {canChange ? (
          <button type="button" className="primary" disabled={isBusy} onClick={onChange}>
            {submitting === "change" ? "処理中..." : "接続先を変更"}
          </button>
        ) : null}
        <button type="button" className={canChange ? undefined : "primary"} disabled={isBusy} onClick={onDisconnect}>
          {submitting === "disconnect" ? "処理中..." : "切断"}
        </button>
      </div>
    );
  }

  return (
    <div className="connect-row">
      <button type="button" className="primary" disabled={isBusy || !connection || !hasTarget} onClick={onConnect}>
        {submitting === "connect" ? "処理中..." : "接続"}
      </button>
    </div>
  );
}
