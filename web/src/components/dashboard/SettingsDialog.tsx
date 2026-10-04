// 責務: ユーザ向け設定（`GET`/`PUT /v1/connection/config`）をモーダルダイアログとして編集する。
// ページ遷移は行わず、保存はダイアログ内の保存ボタン押下時に一括でPUTする
// （webserver/requirements.md「設定ダイアログ」「設定ダイアログの入力項目」参照）。
// 入力項目はタブで切り替えて表示する（同「設定ダイアログのタブ化」）。設定値・保存は全タブで1つ。
// 「動作検証」タブで、保存済みの設定が実際に動作しているかを検証する（webserver/design.md「設定の動作検証の実装方針」）。

import { useEffect, useRef, useState } from "react";
import {
  getV1ConnectionConfig,
  putV1ConnectionConfig,
} from "../../generated/api/default/default";
import type { GetV1ConnectionConfig200 } from "../../generated/api/endpoints.schemas";
import { useDialogOpen } from "../../hooks/useDialogOpen";
import { HorizontalScroll } from "../HorizontalScroll";
import {
  describeApiError,
  describeThrownError,
} from "../../notifications/describe-api-error";
import { isIpv4Cidr } from "../../lib/ipv4-cidr";
import { LineListEditor } from "./LineListEditor";
import { AccountSettingsDialog } from "./AccountSettingsDialog";
import { RebootDialog } from "./RebootDialog";
import { VerificationPanel } from "./verification/VerificationPanel";
import { useVerification } from "../../hooks/useVerification";

interface Props {
  open: boolean;
  onClose: () => void;
  // ゲートウェイ機のLAN側ネットワークCIDR（例: 192.168.3.0/24）。取得できていれば、明示的プロキシの
  // 許可CIDR欄が空のときの初期値に使う（webserver/requirements.md「明示的プロキシの許可CIDRの初期値」）。
  defaultExplicitProxyAllowedCidr?: string;
}

type SettingsTab =
  | "control"
  | "gateway"
  | "dnsResolver"
  | "dnsDetail"
  | "verify"
  | "maintenance";

const TAB_LABELS: Record<SettingsTab, string> = {
  control: "通信制御",
  gateway: "ゲートウェイ",
  dnsResolver: "上位DNSリゾルバ",
  dnsDetail: "DNS詳細",
  verify: "動作検証",
  maintenance: "メンテナンス",
};
const TAB_KEYS = Object.keys(TAB_LABELS) as SettingsTab[];

export function SettingsDialog({
  open,
  onClose,
  defaultExplicitProxyAllowedCidr,
}: Props) {
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isRebootOpen, setIsRebootOpen] = useState(false);
  // パスワード入力のダイアログ（非モーダル）を開いている間は、トップレイヤーのこのダイアログがそれらを覆い、
  // パスワードマネージャの候補表示も隠すため、このダイアログの表示だけを一時的に閉じる（状態は保持する）。
  const isSubDialogOpen = isAccountOpen || isRebootOpen;
  const dialogRef = useDialogOpen(open && !isSubDialogOpen);
  const [settings, setSettings] = useState<GetV1ConnectionConfig200>();
  // 読み込んだ時点の設定（未保存の変更の有無の判定と、動作検証が使う保存済みのIP確認サービスのURL）。
  const [loadedSettings, setLoadedSettings] =
    useState<GetV1ConnectionConfig200>();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<SettingsTab>("control");
  const verification = useVerification(open, loadedSettings?.verifyEchoUrl);
  // 許可CIDRの初期値は、ダイアログを開いた時点の値を使う。ダッシュボードの定期取得で値が変わる（取得の失敗で一時的に
  // 消える等）たびに設定を読み直すと、開いているダイアログのタブ・未保存の入力・動作検証の表示が初期化されてしまうため、
  // 読み込みの契機（useEffectの依存）には含めない。
  const defaultCidrRef = useRef(defaultExplicitProxyAllowedCidr);
  defaultCidrRef.current = defaultExplicitProxyAllowedCidr;

  useEffect(() => {
    if (!open) return;
    setTab("control");
    setIsLoading(true);
    setError(undefined);
    getV1ConnectionConfig()
      .then((response) => {
        if (response.status !== 200) {
          setError(
            describeApiError(
              response.status,
              response.data,
              "設定の取得に失敗しました",
            ).summary,
          );
          return;
        }
        // 許可CIDRが未設定のときだけ、ゲートウェイ機のLANサブネットを初期値として提示する
        // （既に値がある場合は上書きしない）。
        const defaultCidr = defaultCidrRef.current;
        const explicitProxyAllowedCidrs =
          response.data.explicitProxyAllowedCidrs.length === 0 && defaultCidr
            ? [defaultCidr]
            : response.data.explicitProxyAllowedCidrs;
        setSettings({ ...response.data, explicitProxyAllowedCidrs });
        setLoadedSettings({ ...response.data, explicitProxyAllowedCidrs });
      })
      .catch((caughtError: unknown) => {
        setError(
          describeThrownError(caughtError, "設定の取得に失敗しました").summary,
        );
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
        excludedDomains: settings.excludedDomains
          .map((domain) => domain.trim())
          .filter((domain) => domain.length > 0),
        explicitProxyAllowedCidrs: settings.explicitProxyAllowedCidrs.filter(
          (cidr) => cidr.trim().length > 0,
        ),
        dnsUpstreamUrl: settings.dnsUpstreamUrl.trim(),
        dnsFallbackServers: settings.dnsFallbackServers
          .map((server) => server.trim())
          .filter((server) => server.length > 0),
        dnsClientNameServers: settings.dnsClientNameServers
          .map((server) => server.trim())
          .filter((server) => server.length > 0),
        dnsRedirectExcludedCidrs: settings.dnsRedirectExcludedCidrs
          .map((cidr) => cidr.trim())
          .filter((cidr) => cidr.length > 0),
        verifyEchoUrl: settings.verifyEchoUrl.trim(),
      });
      if (response.status !== 200) {
        setError(
          describeApiError(
            response.status,
            response.data,
            "設定の保存に失敗しました",
          ).summary,
        );
        return;
      }
      onClose();
    } catch (caughtError) {
      setError(
        describeThrownError(caughtError, "設定の保存に失敗しました").summary,
      );
    } finally {
      setIsSaving(false);
    }
  }

  // 明示的プロキシが有効なのに、有効な（IPv4 CIDR形式の）許可CIDRが1つも無い場合は保存できない
  // （APIサーバ側でも許可CIDR自体の形式検証は行うが、ここでは「1件も無い」状態を保存前に防ぐ。
  // webserver/requirements.md「明示的プロキシの許可CIDRが無い場合の保存禁止」）。
  const hasValidExplicitProxyAllowedCidr =
    settings?.explicitProxyAllowedCidrs.some((cidr) =>
      isIpv4Cidr(cidr.trim()),
    ) ?? false;
  const explicitProxyNeedsCidr =
    settings?.explicitProxyEnabled === true &&
    !hasValidExplicitProxyAllowedCidr;

  // DNS中継の保存前チェック（APIサーバ側でも検証する。ここでは、保存できない組み合わせを保存前に示す）。
  const dnsFallbackCount =
    settings?.dnsFallbackServers.filter((server) => server.trim().length > 0)
      .length ?? 0;
  const dnsRelayNeedsUpstream =
    settings?.dnsRelayEnabled === true &&
    settings.dnsUpstreamUrl.trim().length === 0 &&
    dnsFallbackCount === 0;
  // 「DNS詳細」タブはDNS中継が有効なときだけ表示するため、無効の間は切り替え先の入力を保存の条件にしない
  // （表示されないタブの入力不備で保存できなくならないようにする）。
  const dnsFallbackNeedsServers =
    settings?.dnsRelayEnabled === true &&
    settings.dnsFailureMode === "fallback" &&
    dnsFallbackCount === 0;
  const hasIncompleteDnsSettings =
    dnsRelayNeedsUpstream || dnsFallbackNeedsServers;
  const verifyEchoUrlMissing =
    settings !== undefined && settings.verifyEchoUrl.trim().length === 0;
  const tabHasIncompleteInput: Record<SettingsTab, boolean> = {
    control: false,
    gateway: explicitProxyNeedsCidr,
    dnsResolver: dnsRelayNeedsUpstream,
    dnsDetail: dnsFallbackNeedsServers,
    verify: verifyEchoUrlMissing,
    maintenance: false,
  };
  const hasUnsavedChanges =
    JSON.stringify(settings) !== JSON.stringify(loadedSettings);
  const visibleTabKeys = TAB_KEYS.filter(
    (key) => key !== "dnsDetail" || settings?.dnsRelayEnabled === true,
  );
  // 表示中の「DNS詳細」タブが、DNS中継を無効にして消えた場合は「上位DNSリゾルバ」へ戻す。
  const activeTab: SettingsTab = visibleTabKeys.includes(tab)
    ? tab
    : "dnsResolver";
  const hasExcludedDomains =
    settings?.excludedDomains.some((domain) => domain.trim().length > 0) ??
    false;

  return (
    // アカウント設定ダイアログ（AccountSettingsDialog）・再起動ダイアログ（RebootDialog）は、この<dialog>の子要素にせず兄弟要素にする
    // （<dialog>同士を入れ子にすると、内側を閉じたときに外側までブラウザによって閉じられてしまうため）。
    <>
      <dialog
        ref={dialogRef}
        onClose={() => {
          if (!isSubDialogOpen) onClose();
        }}
        aria-label="設定"
      >
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
            <HorizontalScroll
              role="tablist"
              aria-label="設定の項目"
              className="location-tabs"
            >
              {visibleTabKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === key}
                  className={activeTab === key ? "tab-active" : undefined}
                  onClick={() => setTab(key)}
                >
                  {TAB_LABELS[key]}
                  {tabHasIncompleteInput[key] ? " !" : ""}
                </button>
              ))}
            </HorizontalScroll>

            <div role="tabpanel" className="settings-tabpanel">
              {activeTab === "control" ? (
                <>
                  <div className="settings-item">
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.killSwitch}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            killSwitch: event.target.checked,
                          })
                        }
                      />
                      Kill Switch
                    </label>
                    <p className="hint">
                      VPN切断を検知したら、LAN側の通信を遮断します。
                    </p>
                  </div>

                  <div className="settings-item">
                    <LineListEditor
                      label="迂回ドメイン"
                      placeholder="example.com"
                      value={settings.excludedDomains}
                      onChange={(excludedDomains) =>
                        setSettings({ ...settings, excludedDomains })
                      }
                    />
                    <p className="hint">
                      VPNを経由せず直接通信するドメインです（split-tunnel）。
                      example.com はそのドメイン自身のみ、*.example.com
                      はサブドメインのみが対象です。両方を迂回するには両方を登録してください。
                    </p>
                  </div>
                  {hasExcludedDomains && !settings.dnsRelayEnabled ? (
                    <p className="restriction">
                      DNS中継が無効なため、迂回ドメインは反映されません。
                    </p>
                  ) : null}
                </>
              ) : activeTab === "gateway" ? (
                <>
                  <div className="settings-item">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.transparentGatewayEnabled}
                      disabled={
                        settings.transparentGatewayEnabled &&
                        !settings.explicitProxyEnabled
                      }
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          transparentGatewayEnabled: event.target.checked,
                        })
                      }
                    />
                    透過ゲートウェイモード
                  </label>
                  </div>

                  <div className="settings-item">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.explicitProxyEnabled}
                      disabled={
                        settings.explicitProxyEnabled &&
                        !settings.transparentGatewayEnabled
                      }
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          explicitProxyEnabled: event.target.checked,
                        })
                      }
                    />
                    明示的プロキシモード（SOCKS5/HTTP）
                  </label>
                  <p className="hint">
                    透過ゲートウェイとの少なくとも一方を有効にしてください。
                  </p>
                  </div>

                  <div className="settings-item">
                  <LineListEditor
                    label="明示的プロキシの許可CIDR"
                    placeholder="192.168.3.0/24"
                    value={settings.explicitProxyAllowedCidrs}
                    onChange={(explicitProxyAllowedCidrs) =>
                      setSettings({ ...settings, explicitProxyAllowedCidrs })
                    }
                    disabled={!settings.explicitProxyEnabled}
                  />
                  <p className="hint">
                    接続元IPがこの範囲内のときだけプロキシを利用できます。他は拒否します。
                  </p>
                  </div>
                  {explicitProxyNeedsCidr ? (
                    <p className="restriction">
                      許可CIDRを1つ以上入力してください。
                    </p>
                  ) : null}
                </>
              ) : activeTab === "verify" ? (
                <>
                  <VerificationPanel
                    verification={verification.verification}
                    isStarting={verification.isStarting}
                    error={verification.error}
                    onStart={() => void verification.start()}
                    hasUnsavedChanges={hasUnsavedChanges}
                    echoUrl={settings.verifyEchoUrl}
                    onEchoUrlChange={(verifyEchoUrl) =>
                      setSettings({ ...settings, verifyEchoUrl })
                    }
                  />
                  {verifyEchoUrlMissing ? (
                    <p className="restriction">
                      IP確認サービスのURLを入力してください。
                    </p>
                  ) : null}
                </>
              ) : activeTab === "maintenance" ? (
                <div className="maintenance-actions">
                  <button type="button" onClick={() => setIsAccountOpen(true)}>
                    アカウント情報を変更
                  </button>
                  <button type="button" onClick={() => setIsRebootOpen(true)}>
                    ゲートウェイ再起動
                  </button>
                </div>
              ) : activeTab === "dnsResolver" ? (
                <>
                  <div className="settings-item">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.dnsRelayEnabled}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          dnsRelayEnabled: event.target.checked,
                        })
                      }
                    />
                    DNS中継を有効にする
                  </label>
                  <p className="hint">
                    迂回ドメインの判定と、自宅DNSサーバでの名前解決を行います。
                    DoH・DoTを使うクライアントは中継できず、迂回ドメインが効きません。
                  </p>
                  </div>

                  <label>
                    自宅DNSサーバ（DoHのURL）
                    <input
                      type="text"
                      placeholder="https://dns.home.example/dns-query"
                      disabled={!settings.dnsRelayEnabled}
                      value={settings.dnsUpstreamUrl}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          dnsUpstreamUrl: event.target.value,
                        })
                      }
                    />
                  </label>
                  <div className="settings-item">
                  <label>
                    自宅DNSサーバのCA証明書（PEM形式）
                    <textarea
                      rows={5}
                      disabled={!settings.dnsRelayEnabled}
                      value={settings.dnsUpstreamCaPem}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          dnsUpstreamCaPem: event.target.value,
                        })
                      }
                    />
                  </label>
                  <p className="hint">
                    公的な認証局の証明書を使う場合は空で構いません。
                  </p>
                  </div>
                  {dnsRelayNeedsUpstream ? (
                    <p className="restriction">
                      自宅DNSサーバのURLか、公開DNSを入力してください。
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <div
                    role="radiogroup"
                    aria-label="自宅DNSサーバが応答しないとき"
                    className="settings-radiogroup"
                  >
                    <label>
                      <input
                        type="radio"
                        name="dnsFailureMode"
                        checked={settings.dnsFailureMode === "failClosed"}
                        onChange={() =>
                          setSettings({
                            ...settings,
                            dnsFailureMode: "failClosed",
                          })
                        }
                      />
                      名前解決を止める
                      <span className="hint">フィルタと履歴を優先</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="dnsFailureMode"
                        checked={settings.dnsFailureMode === "fallback"}
                        onChange={() =>
                          setSettings({
                            ...settings,
                            dnsFailureMode: "fallback",
                          })
                        }
                      />
                      公開DNSへ切り替える
                      <span className="hint">フィルタと履歴は効かなくなる</span>
                    </label>
                  </div>
                  {settings.dnsFailureMode === "fallback" ? (
                    <LineListEditor
                      label="切り替え先の公開DNS（最大3件）"
                      placeholder="1.1.1.1"
                      maxItems={3}
                      value={settings.dnsFallbackServers}
                      onChange={(dnsFallbackServers) =>
                        setSettings({ ...settings, dnsFallbackServers })
                      }
                    />
                  ) : null}

                  <div className="settings-item">
                    <LineListEditor
                      label="クライアント名の取得先（最大3件）"
                      placeholder="192.168.3.254"
                      maxItems={3}
                      value={settings.dnsClientNameServers}
                      onChange={(dnsClientNameServers) =>
                        setSettings({ ...settings, dnsClientNameServers })
                      }
                    />
                    <p className="hint">
                      DHCPサーバ・ルータのDNSを指定します。履歴には、DHCPで配られた名前（例:
                      macmini.lan → macmini-lan）で記録されます。空ならIPアドレスで記録します。
                    </p>
                  </div>

                  <label>
                    <input
                      type="checkbox"
                      checked={settings.dnsRedirectEnabled}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          dnsRedirectEnabled: event.target.checked,
                        })
                      }
                    />
                    手動でDNSを指定した端末の問い合わせも中継する
                  </label>
                  {settings.dnsRedirectEnabled ? (
                    <div className="settings-item">
                      <LineListEditor
                        label="中継しない宛先（CIDR）"
                        placeholder="192.168.3.5/32"
                        value={settings.dnsRedirectExcludedCidrs}
                        onChange={(dnsRedirectExcludedCidrs) =>
                          setSettings({
                            ...settings,
                            dnsRedirectExcludedCidrs,
                          })
                        }
                      />
                      <p className="hint">LAN内のDNSサーバ等を指定します。</p>
                    </div>
                  ) : null}
                  {dnsFallbackNeedsServers ? (
                    <p className="restriction">
                      公開DNSを1つ以上入力してください。
                    </p>
                  ) : null}
                </>
              )}
            </div>

            {error ? <p role="alert">{error}</p> : null}

            <div className="dialog-actions">
              <div className="dialog-actions-group">
                <button
                  type="submit"
                  disabled={
                    isSaving ||
                    explicitProxyNeedsCidr ||
                    hasIncompleteDnsSettings ||
                    verifyEchoUrlMissing
                  }
                >
                  {isSaving ? "保存中..." : "保存"}
                </button>
                <button type="button" disabled={isSaving} onClick={onClose}>
                  キャンセル
                </button>
              </div>
            </div>
          </form>
        )}
      </dialog>
      <AccountSettingsDialog
        open={isAccountOpen}
        onClose={() => setIsAccountOpen(false)}
      />
      <RebootDialog
        open={isRebootOpen}
        onClose={() => setIsRebootOpen(false)}
      />
    </>
  );
}
