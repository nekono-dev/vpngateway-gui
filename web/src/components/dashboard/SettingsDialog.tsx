// 責務: ユーザ向け設定（`GET`/`PUT /v1/connection/config`）をモーダルダイアログとして編集する。
// ページ遷移は行わず、保存はダイアログ内の保存ボタン押下時に一括でPUTする
// （webserver/requirements.md「設定ダイアログ」「設定ダイアログの入力項目」参照）。

import { useEffect, useRef, useState } from "react";
import { getV1ConnectionConfig, putV1ConnectionConfig } from "../../generated/api/default/default";
import type { GetV1ConnectionConfig200 } from "../../generated/api/endpoints.schemas";
import { LineListEditor } from "./LineListEditor";

interface Props {
  open: boolean;
  onClose: () => void;
  countries: string[];
}

export function SettingsDialog({ open, onClose, countries }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<GetV1ConnectionConfig200>();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const dialogElement = dialogRef.current;
    if (!dialogElement) return;
    if (open && !dialogElement.open) {
      dialogElement.showModal();
    } else if (!open && dialogElement.open) {
      dialogElement.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setError(undefined);
    getV1ConnectionConfig()
      .then((response) => {
        if (response.status !== 200) {
          throw new Error(`設定の取得に失敗しました (status: ${response.status})`);
        }
        setSettings(response.data);
      })
      .catch((caughtError: unknown) => {
        setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      })
      .finally(() => setIsLoading(false));
  }, [open]);

  async function handleSave(): Promise<void> {
    if (!settings) return;
    setIsSaving(true);
    setError(undefined);
    try {
      const response = await putV1ConnectionConfig({
        ...settings,
        excludedDomains: settings.excludedDomains.filter((domain) => domain.trim().length > 0),
        explicitProxyAllowedCidrs: settings.explicitProxyAllowedCidrs.filter((cidr) => cidr.trim().length > 0),
      });
      if (response.status !== 200) {
        throw new Error(`設定の保存に失敗しました (status: ${response.status})`);
      }
      onClose();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} aria-label="設定">
      <h2>設定</h2>
      {isLoading || !settings ? (
        <p>読み込み中...</p>
      ) : (
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={settings.killSwitch}
              onChange={(event) => setSettings({ ...settings, killSwitch: event.target.checked })}
            />
            Kill Switch（VPN切断検知時にLAN側通信を遮断する）
          </label>

          <LineListEditor
            label="除外ドメイン（split-tunnel、1行1ドメイン）"
            value={settings.excludedDomains}
            onChange={(excludedDomains) => setSettings({ ...settings, excludedDomains })}
          />

          <label>
            デフォルト接続国
            <select
              value={settings.defaultCountry}
              onChange={(event) => setSettings({ ...settings, defaultCountry: event.target.value })}
            >
              {countries.map((country) => (
                <option key={country} value={country}>
                  {country.toUpperCase()}
                </option>
              ))}
            </select>
          </label>

          <label>
            <input
              type="checkbox"
              checked={settings.transparentGatewayEnabled}
              onChange={(event) => setSettings({ ...settings, transparentGatewayEnabled: event.target.checked })}
            />
            透過ゲートウェイモード
          </label>

          <label>
            <input
              type="checkbox"
              checked={settings.explicitProxyEnabled}
              onChange={(event) => setSettings({ ...settings, explicitProxyEnabled: event.target.checked })}
            />
            明示的プロキシモード（SOCKS5/HTTP）
          </label>

          <LineListEditor
            label="明示的プロキシの許可CIDR（1行1CIDR）"
            value={settings.explicitProxyAllowedCidrs}
            onChange={(explicitProxyAllowedCidrs) => setSettings({ ...settings, explicitProxyAllowedCidrs })}
            disabled={!settings.explicitProxyEnabled}
          />

          {error ? <p role="alert">{error}</p> : null}

          <div>
            <button type="submit" disabled={isSaving}>
              {isSaving ? "保存中..." : "保存"}
            </button>
            <button type="button" disabled={isSaving} onClick={onClose}>
              キャンセル
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
