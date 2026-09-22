// 責務: 有効なVPNベンダーの選択部品（プルダウン）と、選択時の確認・切替の要求のみを行う
// （webserver/requirements.md「ベンダーの選択」、design.md「ベンダーの選択の実装方針」）。ベンダーの保持・切断の手順はAPIが行う。
// 有効なベンダーが1つのときは選択肢を出さず名前のみ表示する（従来の画面と同じ操作感）。
// 【Phase 23】ラジオボタンの並び（画面のデッドスペースが目立つ）からプルダウンへ変更する
// （webserver/requirements.md「ベンダー選択のプルダウン化」）。プルダウンの隣にログイン/ログアウトボタンを
// 並べられるよう、このコンポーネントは選択部品のみを返し、親（App）がCSS Gridで同じ行へ配置する。
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
    <div className="provider-select-row">
      <label className="provider-select-label" htmlFor="provider-select">
        VPNベンダー
      </label>
      <span className="provider-select-wrap">
        <select
          id="provider-select"
          className="provider-select"
          aria-label="VPNベンダー"
          value={active?.id}
          disabled={disabled || isSwitching}
          onChange={(event) => {
            const target = providers.find((provider) => provider.id === event.target.value);
            if (target) void handleSwitch(target);
          }}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id} disabled={!provider.available && !provider.active}>
              {provider.displayName}
              {!provider.available ? `（利用不可: ${provider.unavailableReason ?? "ランナーが起動していません"}）` : ""}
            </option>
          ))}
        </select>
      </span>
      {isSwitching ? <span className="hint">切り替え中...</span> : null}
    </div>
  );
}
