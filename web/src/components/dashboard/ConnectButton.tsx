// 責務: ［接続］ボタン単体の描画のみを行う。切断ボタン（DisconnectButton）と同じ理由（押しやすい位置に
// 置くため、接続先リストの下ではなく接続状態のカードに置く）で独立した部品として切り出した
// （webserver/requirements.md「接続ボタンの配置」）。
// 【Phase 21】無効化の理由文が接続先リスト側（`location-list-restriction`）に既に表示されるとき
// （`connectToLocation`と`locationList`は常に同じ理由へ同期されるため）は、同じ文言を重ねて表示せず、
// `aria-describedby`だけをそちらへ向ける（webserver/design.md「制限理由の重複表示の解消」）。
import { connectBlockedReason, isAvailable, reasonOf } from "../../capabilities/capability-state";
import type { CapabilitiesState } from "../../hooks/useDashboardPolling";
import { RestrictionNote } from "./RestrictionNote";

interface Props {
  submitting: boolean;
  // 接続の対象となる接続先があるか（自動接続のときは接続先が不要なため、親がtrueにする）。無ければ押せない。
  hasTarget: boolean;
  capabilities: CapabilitiesState | undefined;
  disabled: boolean;
  onConnect: () => void;
}

export function ConnectButton({ submitting, hasTarget, capabilities, disabled, onConnect }: Props) {
  // 切断中の［接続］。接続先指定・自動接続のどちらも使えないときは理由を表示して無効化する。
  const blockedReason = connectBlockedReason(capabilities);
  const canConnect = isAvailable(capabilities, "connectToLocation") || isAvailable(capabilities, "connectAuto");
  // 接続先リスト側に同じ理由文が表示されるときは、自身の理由表示を省いて参照だけにする（重複表示の回避）。
  const reasonShownInLocationList = blockedReason !== undefined && blockedReason === reasonOf(capabilities, "locationList");
  return (
    <span className="connect-action">
      <button
        type="button"
        className="primary"
        disabled={submitting || disabled || !hasTarget || !canConnect}
        aria-describedby={blockedReason === undefined ? undefined : reasonShownInLocationList ? "location-list-restriction" : "connect-restriction"}
        onClick={onConnect}
      >
        {submitting ? "処理中..." : "接続"}
      </button>
      {reasonShownInLocationList ? null : <RestrictionNote id="connect-restriction" message={blockedReason} />}
    </span>
  );
}
