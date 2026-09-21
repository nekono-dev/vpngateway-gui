// 責務: 接続／切断／「接続先を変更」ボタンの出し分けと二重送信防止（送信中は全ボタンを無効化）、および
// 操作の実行可否（capability）による無効化・理由表示のみを行う（webserver/requirements.md「接続先リスト」「操作の制限表示」、
// design.md「選択・ボタンの状態遷移」）。何を接続先とするか、自動接続として使うかの決定は親が行う。
import type { CapabilitiesState, ConnectionState } from "../../hooks/useDashboardPolling";
import { connectBlockedReason, isAvailable, reasonOf } from "../../capabilities/capability-state";
import { RestrictionNote } from "./RestrictionNote";

export type SubmittingAction = "connect" | "change" | "disconnect";

interface Props {
  connection: ConnectionState | undefined;
  // 実行中の操作。undefinedなら待機中。
  submitting: SubmittingAction | undefined;
  // 接続・変更の対象となる接続先があるか（自動接続のときは接続先が不要なため、親がtrueにする）。無ければ［接続］を押せない。
  hasTarget: boolean;
  // 接続中で、対象が現在の接続先と異なるか。真のときだけ［接続先を変更］を表示する。
  canChange: boolean;
  // 操作の実行可否。未取得ならundefined（制限しない）。
  capabilities: CapabilitiesState | undefined;
  // ベンダーの切替中など、全ての操作を止める（Phase 11）。
  disabled?: boolean;
  onConnect: () => void;
  onChange: () => void;
  onDisconnect: () => void;
}

export function ConnectionActions({
  connection,
  submitting,
  hasTarget,
  canChange,
  capabilities,
  disabled = false,
  onConnect,
  onChange,
  onDisconnect,
}: Props) {
  const isBusy = submitting !== undefined || disabled;
  const disconnectReason = reasonOf(capabilities, "disconnect");

  if (connection?.status === "connected") {
    const changeReason = reasonOf(capabilities, "changeLocation");
    return (
      <div className="connect-row">
        {canChange ? (
          <button
            type="button"
            className="primary"
            disabled={isBusy || changeReason !== undefined}
            aria-describedby={changeReason === undefined ? undefined : "change-restriction"}
            onClick={onChange}
          >
            {submitting === "change" ? "処理中..." : "接続先を変更"}
          </button>
        ) : null}
        <button
          type="button"
          className={canChange ? undefined : "primary"}
          disabled={isBusy || disconnectReason !== undefined}
          aria-describedby={disconnectReason === undefined ? undefined : "disconnect-restriction"}
          onClick={onDisconnect}
        >
          {submitting === "disconnect" ? "処理中..." : "切断"}
        </button>
        {canChange ? <RestrictionNote id="change-restriction" message={changeReason} /> : null}
        <RestrictionNote id="disconnect-restriction" message={disconnectReason} />
      </div>
    );
  }

  // 切断中の［接続］。接続先指定・自動接続のどちらも使えないときは理由を表示して無効化する。
  const blockedReason = connectBlockedReason(capabilities);
  const canConnect = isAvailable(capabilities, "connectToLocation") || isAvailable(capabilities, "connectAuto");
  return (
    <div className="connect-row">
      <button
        type="button"
        className="primary"
        disabled={isBusy || !connection || !hasTarget || !canConnect}
        aria-describedby={blockedReason === undefined ? undefined : "connect-restriction"}
        onClick={onConnect}
      >
        {submitting === "connect" ? "処理中..." : "接続"}
      </button>
      <RestrictionNote id="connect-restriction" message={blockedReason} />
    </div>
  );
}
