// 責務: ユーザ向け設定（`GET`/`PUT /v1/connection/config`）をモーダルダイアログとして編集する。
// ページ遷移は行わず、保存はダイアログ内の保存ボタン押下時に一括でPUTする
// （webserver/requirements.md「設定ダイアログ」「設定ダイアログの入力項目」参照）。
// 入力項目はタブで切り替えて表示する（同「設定ダイアログのタブ化」）。設定値・保存は全タブで1つ。

import { useEffect, useState } from "react";
import { getV1ConnectionConfig, putV1ConnectionConfig } from "../../generated/api/default/default";
import type { GetV1ConnectionConfig200 } from "../../generated/api/endpoints.schemas";
import { useDialogOpen } from "../../hooks/useDialogOpen";
import { describeApiError, describeThrownError } from "../../notifications/describe-api-error";
import { isIpv4Cidr } from "../../lib/ipv4-cidr";
import { LineListEditor } from "./LineListEditor";
import { AccountSettingsDialog } from "./AccountSettingsDialog";

interface Props {
  open: boolean;
  onClose: () => void;
  // ゲートウェイ機のLAN側ネットワークCIDR（例: 192.168.3.0/24）。取得できていれば、明示的プロキシの
  // 許可CIDR欄が空のときの初期値に使う（webserver/requirements.md「明示的プロキシの許可CIDRの初期値」）。
  defaultExplicitProxyAllowedCidr?: string;
}

type SettingsTab = "control" | "gateway" | "dnsResolver" | "dnsDetail";

const TAB_LABELS: Record<SettingsTab, string> = {
  control: "通信制御",
  gateway: "ゲートウェイ",
  dnsResolver: "上位DNSリゾルバ",
  dnsDetail: "DNS詳細",
};
const TAB_KEYS = Object.keys(TAB_LABELS) as SettingsTab[];

export function SettingsDialog({ open, onClose, defaultExplicitProxyAllowedCidr }: Props) {
  const dialogRef = useDialogOpen(open);
  const [settings, setSettings] = useState<GetV1ConnectionConfig200>();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("control");

  useEffect(() => {
    if (!open) return;
    setTab("control");
    setIsLoading(true);
    setError(undefined);
    getV1ConnectionConfig()
      .then((response) => {
        if (response.status !== 200) {
          setError(describeApiError(response.status, response.data, "設定の取得に失敗しました").summary);
          return;
        }
        // 許可CIDRが未設定のときだけ、ゲートウェイ機のLANサブネットを初期値として提示する
        // （既に値がある場合は上書きしない）。
        const explicitProxyAllowedCidrs =
          response.data.explicitProxyAllowedCidrs.length === 0 && defaultExplicitProxyAllowedCidr
            ? [defaultExplicitProxyAllowedCidr]
            : response.data.explicitProxyAllowedCidrs;
        setSettings({ ...response.data, explicitProxyAllowedCidrs });
      })
      .catch((caughtError: unknown) => {
        setError(describeThrownError(caughtError, "設定の取得に失敗しました").summary);
      })
      .finally(() => setIsLoading(false));
  }, [open, defaultExplicitProxyAllowedCidr]);

  async function handleSave(): Promise<void> {
    if (!settings) return;
    setIsSaving(true);
    setError(undefined);
    try {
      const response = await putV1ConnectionConfig({
        ...settings,
        excludedDomains: settings.excludedDomains.map((domain) => domain.trim()).filter((domain) => domain.length > 0),
        explicitProxyAllowedCidrs: settings.explicitProxyAllowedCidrs.filter((cidr) => cidr.trim().length > 0),
        dnsUpstreamUrl: settings.dnsUpstreamUrl.trim(),
        dnsFallbackServers: settings.dnsFallbackServers.map((server) => server.trim()).filter((server) => server.length > 0),
        dnsClientNameServers: settings.dnsClientNameServers.map((server) => server.trim()).filter((server) => server.length > 0),
        dnsRedirectExcludedCidrs: settings.dnsRedirectExcludedCidrs.map((cidr) => cidr.trim()).filter((cidr) => cidr.length > 0),
      });
      if (response.status !== 200) {
        setError(describeApiError(response.status, response.data, "設定の保存に失敗しました").summary);
        return;
      }
      onClose();
    } catch (caughtError) {
      setError(describeThrownError(caughtError, "設定の保存に失敗しました").summary);
    } finally {
      setIsSaving(false);
    }
  }

  // 明示的プロキシが有効なのに、有効な（IPv4 CIDR形式の）許可CIDRが1つも無い場合は保存できない
  // （APIサーバ側でも許可CIDR自体の形式検証は行うが、ここでは「1件も無い」状態を保存前に防ぐ。
  // webserver/requirements.md「明示的プロキシの許可CIDRが無い場合の保存禁止」）。
  const hasValidExplicitProxyAllowedCidr = settings?.explicitProxyAllowedCidrs.some((cidr) => isIpv4Cidr(cidr.trim())) ?? false;
  const explicitProxyNeedsCidr = settings?.explicitProxyEnabled === true && !hasValidExplicitProxyAllowedCidr;

  // DNS中継の保存前チェック（APIサーバ側でも検証する。ここでは、保存できない組み合わせを保存前に示す）。
  const dnsFallbackCount = settings?.dnsFallbackServers.filter((server) => server.trim().length > 0).length ?? 0;
  const dnsRelayNeedsUpstream =
    settings?.dnsRelayEnabled === true && settings.dnsUpstreamUrl.trim().length === 0 && dnsFallbackCount === 0;
  // 「DNS詳細」タブはDNS中継が有効なときだけ表示するため、無効の間は切り替え先の入力を保存の条件にしない
  // （表示されないタブの入力不備で保存できなくならないようにする）。
  const dnsFallbackNeedsServers =
    settings?.dnsRelayEnabled === true && settings.dnsFailureMode === "fallback" && dnsFallbackCount === 0;
  const hasIncompleteDnsSettings = dnsRelayNeedsUpstream || dnsFallbackNeedsServers;
  const tabHasIncompleteInput: Record<SettingsTab, boolean> = {
    control: false,
    gateway: explicitProxyNeedsCidr,
    dnsResolver: dnsRelayNeedsUpstream,
    dnsDetail: dnsFallbackNeedsServers,
  };
  const visibleTabKeys = TAB_KEYS.filter((key) => key !== "dnsDetail" || settings?.dnsRelayEnabled === true);
  // 表示中の「DNS詳細」タブが、DNS中継を無効にして消えた場合は「上位DNSリゾルバ」へ戻す。
  const activeTab: SettingsTab = visibleTabKeys.includes(tab) ? tab : "dnsResolver";
  const hasExcludedDomains = settings?.excludedDomains.some((domain) => domain.trim().length > 0) ?? false;

  return (
    // アカウント設定ダイアログ（AccountSettingsDialog）は、この<dialog>の子要素にせず兄弟要素にする
    // （<dialog>同士を入れ子にすると、内側を閉じたときに外側までブラウザによって閉じられてしまうため）。
    <>
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
            <div role="tablist" aria-label="設定の項目" className="location-tabs">
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
            </div>

            <div role="tabpanel" className="settings-tabpanel">
              {activeTab === "control" ? (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.killSwitch}
                      onChange={(event) => setSettings({ ...settings, killSwitch: event.target.checked })}
                    />
                    Kill Switch（VPN切断検知時にLAN側通信を遮断する）
                  </label>

                  <LineListEditor
                    label="迂回ドメイン（split-tunnel、1行1ドメイン）"
                    placeholder={"VPNを経由せず直接通信するドメイン\nexample.com ← example.com自身のみ\n*.example.com ← サブドメインのみ（example.com自身は含まない）"}
                    value={settings.excludedDomains}
                    onChange={(excludedDomains) => setSettings({ ...settings, excludedDomains })}
                  />
                  <p className="hint">ドメインとそのサブドメインの両方を迂回するには、example.com と *.example.com の両方を登録してください。</p>
                  {hasExcludedDomains && !settings.dnsRelayEnabled ? (
                    <p className="restriction">DNS中継が無効なため、迂回ドメインは反映されません。</p>
                  ) : null}
                </>
              ) : activeTab === "gateway" ? (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.transparentGatewayEnabled}
                      disabled={settings.transparentGatewayEnabled && !settings.explicitProxyEnabled}
                      onChange={(event) => setSettings({ ...settings, transparentGatewayEnabled: event.target.checked })}
                    />
                    透過ゲートウェイモード
                  </label>

                  <label>
                    <input
                      type="checkbox"
                      checked={settings.explicitProxyEnabled}
                      disabled={settings.explicitProxyEnabled && !settings.transparentGatewayEnabled}
                      onChange={(event) => setSettings({ ...settings, explicitProxyEnabled: event.target.checked })}
                    />
                    明示的プロキシモード（SOCKS5/HTTP）
                  </label>
                  <p className="hint">透過ゲートウェイ・明示的プロキシは少なくとも一方を有効にする必要があります。</p>

                  <LineListEditor
                    label="明示的プロキシの許可CIDR"
                    placeholder={"接続元IPがこの範囲内のみプロキシ利用を許可（他は拒否）\n192.168.3.0/24 ← 192.168.3.1〜254のLAN全体を許可\n10.0.0.5/32 ← 10.0.0.5の1台のみ許可"}
                    value={settings.explicitProxyAllowedCidrs}
                    onChange={(explicitProxyAllowedCidrs) => setSettings({ ...settings, explicitProxyAllowedCidrs })}
                    disabled={!settings.explicitProxyEnabled}
                  />
                  {explicitProxyNeedsCidr ? (
                    <p className="restriction">明示的プロキシモードを使うには、有効な許可CIDRを1つ以上入力してください。</p>
                  ) : null}
                </>
              ) : activeTab === "dnsResolver" ? (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.dnsRelayEnabled}
                      onChange={(event) => setSettings({ ...settings, dnsRelayEnabled: event.target.checked })}
                    />
                    DNS中継を有効にする（迂回ドメインの判定と、自宅DNSサーバでの名前解決）
                  </label>
                  <p className="hint">暗号化DNS（DoH・DoT）を使うクライアントは中継できないため、迂回ドメインが効きません。</p>

                  <label>
                    自宅DNSサーバ（DoHのURL）
                    <input
                      type="text"
                      placeholder="https://dns.home.example/dns-query"
                      disabled={!settings.dnsRelayEnabled}
                      value={settings.dnsUpstreamUrl}
                      onChange={(event) => setSettings({ ...settings, dnsUpstreamUrl: event.target.value })}
                    />
                  </label>
                  <label>
                    自宅DNSサーバの証明書を発行したCA（PEM形式。公的な認証局の証明書なら空でよい）
                    <textarea
                      rows={4}
                      disabled={!settings.dnsRelayEnabled}
                      value={settings.dnsUpstreamCaPem}
                      onChange={(event) => setSettings({ ...settings, dnsUpstreamCaPem: event.target.value })}
                    />
                  </label>
                  {dnsRelayNeedsUpstream ? (
                    <p className="restriction">DNS中継を使うには、自宅DNSサーバのURLか、切り替え先の公開DNSを入力してください。</p>
                  ) : null}
                </>
              ) : (
                <>
                  <div role="radiogroup" aria-label="自宅DNSサーバが応答しないとき">
                    <label>
                      <input
                        type="radio"
                        name="dnsFailureMode"
                        checked={settings.dnsFailureMode === "failClosed"}
                        onChange={() => setSettings({ ...settings, dnsFailureMode: "failClosed" })}
                      />
                      名前解決を止める（フィルタと履歴を優先）
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="dnsFailureMode"
                        checked={settings.dnsFailureMode === "fallback"}
                        onChange={() => setSettings({ ...settings, dnsFailureMode: "fallback" })}
                      />
                      公開DNSへ切り替える（フィルタと履歴は効かなくなる）
                    </label>
                  </div>
                  <LineListEditor
                    label="切り替え先の公開DNS（1行1アドレス、最大3件）"
                    placeholder={"1.1.1.1"}
                    value={settings.dnsFallbackServers}
                    onChange={(dnsFallbackServers) => setSettings({ ...settings, dnsFallbackServers })}
                    disabled={settings.dnsFailureMode !== "fallback"}
                  />

                  <LineListEditor
                    label="クライアント名の取得先（DHCPサーバ・ルータのDNS、1行1アドレス、最大3件。空ならIPアドレスで記録）"
                    placeholder={"192.168.3.254"}
                    value={settings.dnsClientNameServers}
                    onChange={(dnsClientNameServers) => setSettings({ ...settings, dnsClientNameServers })}
                  />
                  <p className="hint">指定すると、自宅DNSサーバの履歴に、DHCPで配られた名前（例: macmini.lan → macmini-lan）でクライアントが記録されます。</p>

                  <label>
                    <input
                      type="checkbox"
                      checked={settings.dnsRedirectEnabled}
                        onChange={(event) => setSettings({ ...settings, dnsRedirectEnabled: event.target.checked })}
                    />
                    手動でDNSを指定した端末の問い合わせも中継する
                  </label>
                  <LineListEditor
                    label="中継しない宛先（LAN内のDNSサーバ等、1行1CIDR）"
                    placeholder={"192.168.3.5/32"}
                    value={settings.dnsRedirectExcludedCidrs}
                    onChange={(dnsRedirectExcludedCidrs) => setSettings({ ...settings, dnsRedirectExcludedCidrs })}
                    disabled={!settings.dnsRedirectEnabled}
                  />
                  {dnsFallbackNeedsServers ? (
                    <p className="restriction">公開DNSへ切り替えるには、切り替え先の公開DNSを1つ以上入力してください。</p>
                  ) : null}
                </>
              )}
            </div>

            {error ? <p role="alert">{error}</p> : null}

            <div className="dialog-actions">
              <button type="button" onClick={() => setIsAccountOpen(true)}>
                アカウント情報を変更
              </button>
              {/* 保存・キャンセルは常に横並びのまま折り返す（狭い幅ではアカウント情報ボタンと分かれて次の行へ回る） */}
              <div className="dialog-actions-group">
                <button type="submit" disabled={isSaving || explicitProxyNeedsCidr || hasIncompleteDnsSettings}>
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
      <AccountSettingsDialog open={isAccountOpen} onClose={() => setIsAccountOpen(false)} />
    </>
  );
}
