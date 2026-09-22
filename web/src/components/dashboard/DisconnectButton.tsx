// 責務: 切断ボタン単体の描画のみを行う。押し間違いを避けつつ押しやすい位置（SessionCardのログイン/
// ログアウト導線の隣）に置けるよう、独立した部品として切り出した（webserver/requirements.md「切断ボタンの配置・強調」）。
import type { CapabilitiesState } from "../../hooks/useDashboardPolling";
import { reasonOf } from "../../capabilities/capability-state";
import { RestrictionNote } from "./RestrictionNote";

interface Props {
  submitting: boolean;
  capabilities: CapabilitiesState | undefined;
  disabled: boolean;
  onDisconnect: () => void;
}

export function DisconnectButton({ submitting, capabilities, disabled, onDisconnect }: Props) {
  const disconnectReason = reasonOf(capabilities, "disconnect");
  return (
    <span className="disconnect-action">
      <button
        type="button"
        className="danger"
        disabled={submitting || disabled || disconnectReason !== undefined}
        aria-describedby={disconnectReason === undefined ? undefined : "disconnect-restriction"}
        onClick={onDisconnect}
      >
        {submitting ? "処理中..." : "切断"}
      </button>
      <RestrictionNote id="disconnect-restriction" message={disconnectReason} />
    </span>
  );
}
