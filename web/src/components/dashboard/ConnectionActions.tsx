// 責務: ［接続先を変更］ボタンの表示と二重送信防止（送信中は無効化）、および操作の実行可否（capability）
// による無効化・理由表示のみを行う（webserver/requirements.md「接続先リスト」「操作の制限表示」、
// design.md「選択・ボタンの状態遷移」）。何を接続先とするか、自動接続として使うかの決定は親が行う。
// ［接続］［切断］ボタンはSessionCard側（ログイン/ログアウト導線の隣）に置くため、ここでは扱わない
// （Phase 16「接続・切断ボタンの配置」）。
import type { CapabilitiesState, ConnectionState } from "../../hooks/useDashboardPolling";
import { reasonOf } from "../../capabilities/capability-state";
import { RestrictionNote } from "./RestrictionNote";

export type SubmittingAction = "connect" | "change" | "disconnect";

interface Props {
  connection: ConnectionState | undefined;
  // 実行中の操作。undefinedなら待機中。
  submitting: SubmittingAction | undefined;
  // 接続中で、対象が現在の接続先と異なるか。真のときだけ［接続先を変更］を表示する。
  canChange: boolean;
  // 操作の実行可否。未取得ならundefined（制限しない）。
  capabilities: CapabilitiesState | undefined;
  // ベンダーの切替中など、全ての操作を止める（Phase 11）。
  disabled?: boolean;
  onChange: () => void;
}

export function ConnectionActions({ connection, submitting, canChange, capabilities, disabled = false, onChange }: Props) {
  const isBusy = submitting !== undefined || disabled;

  if (connection?.status !== "connected" || !canChange) return null;
  const changeReason = reasonOf(capabilities, "changeLocation");
  return (
    <div className="connect-row">
      <button
        type="button"
        className="primary"
        disabled={isBusy || changeReason !== undefined}
        aria-describedby={changeReason === undefined ? undefined : "change-restriction"}
        onClick={onChange}
      >
        {submitting === "change" ? "処理中..." : "接続先を変更"}
      </button>
      <RestrictionNote id="change-restriction" message={changeReason} />
    </div>
  );
}
