// 責務: 有効なVPNベンダーの選択部品（ラジオ入力のグループ）と、選択時の確認・切替の要求のみを行う
// （webserver/requirements.md「ベンダーの選択」、design.md「ベンダーの選択の実装方針」）。ベンダーの保持・切断の手順はAPIが行う。
// 有効なベンダーが1つのときは選択肢を出さず名前のみ表示する（従来の画面と同じ操作感）。
import { useState } from "react";
import type { ProviderItem } from "../../hooks/useDashboardPolling";
import { putV1ProvidersActive } from "../../generated/api/default/default";
import { describeApiError, describeThrownError } from "../../notifications/describe-api-error";
import { useToast } from "../../notifications/ToastProvider";

interface Props {
  providers: ProviderItem[];
  // VPNに接続中か。接続中の切替は確認ダイアログを出す（現在のVPNが切断されるため）。
  connected: boolean;
  // 切替に成功した後に呼ぶ（状態の再取得）。
  onSwitched: () => void;
  // 切替の開始・終了を親へ知らせる（切替中は他の操作を無効化するため）。
  onSwitchingChange: (switching: boolean) => void;
  // 他の操作の実行中など、切替を始められない状態。
  disabled: boolean;
}

export function ProviderSelector({ providers, connected, onSwitched, onSwitchingChange, disabled }: Props) {
  const [isSwitching, setIsSwitching] = useState(false);
  const { notifyError, notifySuccess } = useToast();
  const active = providers.find((provider) => provider.active);

  /**
   * 目的: 選択されたベンダーへ切り替える。接続中は確認し、承諾されたときだけ要求する。
   * 入力: target(切替先のベンダー)。
   * 出力: なし（例外は投げない）。失敗はトーストで通知し、選択は元のベンダーのまま（サーバ側の状態が正）。
   */
  async function handleSwitch(target: ProviderItem): Promise<void> {
    if (target.active || !target.available) return;
    if (
      connected &&
      !window.confirm(
        `接続中の${active?.displayName ?? "VPN"}を切断して、${target.displayName}へ切り替えます。` +
          "Kill Switchが有効な間は、切断から新しいベンダーへ接続するまでLAN機器の通信が遮断されます。よろしいですか？",
      )
    ) {
      return;
    }
    setIsSwitching(true);
    onSwitchingChange(true);
    try {
      const response = await putV1ProvidersActive({ providerId: target.id });
      if (response.status !== 200) {
        notifyError(describeApiError(response.status, response.data, "ベンダーの切替に失敗しました"));
        return;
      }
      notifySuccess(`${target.displayName}へ切り替えました`);
      onSwitched();
    } catch (caughtError) {
      notifyError(describeThrownError(caughtError, "ベンダーの切替に失敗しました"));
    } finally {
      setIsSwitching(false);
      onSwitchingChange(false);
    }
  }

  // 有効なベンダーが1つだけなら、選択肢は出さず名前だけを表示する。
  if (providers.length <= 1) {
    return providers[0] ? (
      <p className="provider-name">
        VPNベンダー: <strong>{providers[0].displayName}</strong>
      </p>
    ) : null;
  }

  return (
    <fieldset className="provider-selector" disabled={disabled || isSwitching}>
      <legend>VPNベンダー</legend>
      <div className="provider-options" role="radiogroup" aria-label="VPNベンダー">
        {providers.map((provider) => (
          <label key={provider.id} className={`provider-option${provider.active ? " provider-active" : ""}`}>
            <input
              type="radio"
              name="provider"
              checked={provider.active}
              disabled={!provider.available && !provider.active}
              onChange={() => void handleSwitch(provider)}
            />
            <span>{provider.displayName}</span>
            {!provider.available ? (
              <span className="hint provider-unavailable">（利用不可: {provider.unavailableReason ?? "ランナーが起動していません"}）</span>
            ) : null}
          </label>
        ))}
      </div>
      {isSwitching ? <p className="hint">切り替え中...</p> : null}
    </fieldset>
  );
}
