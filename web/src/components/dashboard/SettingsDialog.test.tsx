// 責務: 設定ダイアログ（SettingsDialog）のテスト。タブ表示（切替・未保存入力の保持・保存不可時の警告印）と、Phase 14で加えた迂回ドメイン・DNS中継の入力（表示・保存前チェック・送信内容）を検証する。

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getV1ConnectionConfig: vi.fn(),
  putV1ConnectionConfig: vi.fn(),
  putV1Operator: vi.fn(),
}));
vi.mock("../../generated/api/default/default", () => api);

const { SettingsDialog } = await import("./SettingsDialog");

const BASE_SETTINGS = {
  killSwitch: true,
  excludedDomains: [] as string[],
  transparentGatewayEnabled: true,
  explicitProxyEnabled: false,
  explicitProxyAllowedCidrs: [] as string[],
  dnsRelayEnabled: false,
  dnsUpstreamUrl: "",
  dnsUpstreamCaPem: "",
  dnsFailureMode: "failClosed",
  dnsFallbackServers: [] as string[],
  dnsClientNameServers: [] as string[],
  dnsRedirectEnabled: false,
  dnsRedirectExcludedCidrs: [] as string[],
};

async function renderDialog(overrides: Partial<typeof BASE_SETTINGS> = {}) {
  api.getV1ConnectionConfig.mockResolvedValue({ status: 200, data: { ...BASE_SETTINGS, ...overrides } });
  render(<SettingsDialog open onClose={() => undefined} />);
  await screen.findByRole("tab", { name: "通信制御" });
}

async function openTab(name: string | RegExp) {
  await userEvent.click(screen.getByRole("tab", { name }));
}

describe("SettingsDialog: タブ", () => {
  beforeEach(() => {
    api.getV1ConnectionConfig.mockReset();
    api.putV1ConnectionConfig.mockReset();
    api.putV1ConnectionConfig.mockResolvedValue({ status: 200, data: BASE_SETTINGS });
  });

  it("先頭の「通信制御」タブを表示し、タブで項目を切り替えられる", async () => {
    await renderDialog();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["通信制御", "ゲートウェイ", "上位DNSリゾルバ"]);
    expect(screen.getByRole("tab", { name: "通信制御" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("checkbox", { name: /Kill Switch/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /明示的プロキシモード/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /DNS中継を有効にする/ })).not.toBeInTheDocument();

    await openTab("ゲートウェイ");
    expect(screen.getByRole("checkbox", { name: /明示的プロキシモード/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Kill Switch/ })).not.toBeInTheDocument();

    await openTab("上位DNSリゾルバ");
    expect(screen.getByRole("checkbox", { name: /DNS中継を有効にする/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/自宅DNSサーバ（DoHのURL）/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /明示的プロキシモード/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/公開DNSへ切り替える/)).not.toBeInTheDocument();
  });

  it("「DNS詳細」タブはDNS中継が有効なときだけ表示し、切り替え先・クライアント名・リダイレクトの設定を持つ", async () => {
    await renderDialog();
    expect(screen.queryByRole("tab", { name: "DNS詳細" })).not.toBeInTheDocument();

    await openTab("上位DNSリゾルバ");
    await userEvent.click(screen.getByLabelText(/DNS中継を有効にする/));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["通信制御", "ゲートウェイ", "上位DNSリゾルバ !", "DNS詳細"]);

    await openTab("DNS詳細");
    expect(screen.getByLabelText(/名前解決を止める/)).toBeInTheDocument();
    expect(screen.getByLabelText(/切り替え先の公開DNS/)).toBeInTheDocument();
    expect(screen.getByLabelText(/クライアント名の取得先/)).toBeInTheDocument();
    expect(screen.getByLabelText(/手動でDNSを指定した端末/)).toBeInTheDocument();
    expect(screen.getByLabelText(/中継しない宛先/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/自宅DNSサーバ（DoHのURL）/)).not.toBeInTheDocument();

    // 無効へ戻すと、表示中の「DNS詳細」は消え、「上位DNSリゾルバ」へ戻る
    await openTab("上位DNSリゾルバ !");
    await userEvent.click(screen.getByLabelText(/DNS中継を有効にする/));
    expect(screen.queryByRole("tab", { name: "DNS詳細" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "上位DNSリゾルバ" })).toHaveAttribute("aria-selected", "true");
  });

  it("DNS詳細の入力不備（公開DNSへ切り替えるのに切り替え先が空）は、DNS詳細タブに警告印が付く。DNS中継が無効なら保存を妨げない", async () => {
    await renderDialog({ dnsRelayEnabled: true, dnsUpstreamUrl: "https://dns.home.example/dns-query", dnsFailureMode: "fallback" });
    expect(screen.getByRole("tab", { name: "DNS詳細 !" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "上位DNSリゾルバ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    await openTab("上位DNSリゾルバ");
    await userEvent.click(screen.getByLabelText(/DNS中継を有効にする/));
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("タブを切り替えても未保存の入力は保持され、保存は全タブの内容を一括でPUTする", async () => {
    await renderDialog({ dnsUpstreamUrl: "https://dns.home.example/dns-query" });
    await userEvent.click(screen.getByRole("checkbox", { name: /Kill Switch/ }));
    await openTab("ゲートウェイ");
    await userEvent.click(screen.getByRole("checkbox", { name: /明示的プロキシモード/ }));
    await userEvent.type(screen.getByLabelText(/明示的プロキシの許可CIDR/), "192.168.3.0/24");
    await openTab("上位DNSリゾルバ");
    await userEvent.click(screen.getByLabelText(/DNS中継を有効にする/));
    await openTab("通信制御");
    expect(screen.getByRole("checkbox", { name: /Kill Switch/ })).not.toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.putV1ConnectionConfig).toHaveBeenCalled());
    expect(api.putV1ConnectionConfig.mock.calls[0][0]).toMatchObject({
      killSwitch: false,
      explicitProxyEnabled: true,
      explicitProxyAllowedCidrs: ["192.168.3.0/24"],
      dnsRelayEnabled: true,
    });
  });

  it("許可CIDRが無く保存できないとき、別タブ表示中でも保存が無効で、ゲートウェイタブに警告印が付く", async () => {
    await renderDialog({ explicitProxyEnabled: true, explicitProxyAllowedCidrs: ["not-a-cidr"] });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "ゲートウェイ !" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "上位DNSリゾルバ" })).toBeInTheDocument();
    await openTab("ゲートウェイ !");
    expect(screen.getByText(/有効な許可CIDRを1つ以上入力/)).toBeInTheDocument();
  });

  it("上位DNSリゾルバの入力が不完全で保存できないとき、上位DNSリゾルバタブに警告印が付く", async () => {
    await renderDialog({ dnsRelayEnabled: true });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "上位DNSリゾルバ !" })).toBeInTheDocument();
  });
});

describe("SettingsDialog: 迂回ドメイン・DNS中継", () => {
  beforeEach(() => {
    api.getV1ConnectionConfig.mockReset();
    api.putV1ConnectionConfig.mockReset();
    api.putV1ConnectionConfig.mockResolvedValue({ status: 200, data: BASE_SETTINGS });
  });

  it("「未対応」の暫定表示は出さず、ドメインの表記規則（両方の登録が必要）を案内する", async () => {
    await renderDialog();
    expect(screen.queryByText(/未対応/)).not.toBeInTheDocument();
    expect(screen.getByText(/example\.com と \*\.example\.com の両方を登録/)).toBeInTheDocument();
  });

  it("迂回ドメインがあるのにDNS中継が無効なら、反映されない旨を表示する。有効にすると消える", async () => {
    await renderDialog({ excludedDomains: ["example.com"] });
    expect(screen.getByText("DNS中継が無効なため、迂回ドメインは反映されません。")).toBeInTheDocument();
    await openTab("上位DNSリゾルバ");
    await userEvent.click(screen.getByLabelText(/DNS中継を有効にする/));
    await openTab("通信制御");
    expect(screen.queryByText("DNS中継が無効なため、迂回ドメインは反映されません。")).not.toBeInTheDocument();
  });

  it("DNS中継が無効の間は、上流のURL・CAの入力欄を無効化する", async () => {
    await renderDialog();
    await openTab("上位DNSリゾルバ");
    expect(screen.getByLabelText(/自宅DNSサーバ（DoHのURL）/)).toBeDisabled();
    expect(screen.getByLabelText(/自宅DNSサーバの証明書を発行したCA/)).toBeDisabled();
  });

  it("DNS中継を有効にしたのに上流もフォールバック先も空なら、保存できず理由を示す", async () => {
    await renderDialog();
    await openTab("上位DNSリゾルバ");
    await userEvent.click(screen.getByLabelText(/DNS中継を有効にする/));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByText(/自宅DNSサーバのURLか、切り替え先の公開DNSを入力/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/自宅DNSサーバ（DoHのURL）/), "https://dns.home.example/dns-query");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("「公開DNSへ切り替える」を選ぶと、切り替え先が空の間は保存できない", async () => {
    await renderDialog({ dnsRelayEnabled: true, dnsUpstreamUrl: "https://dns.home.example/dns-query" });
    await openTab("DNS詳細");
    await userEvent.click(screen.getByLabelText(/公開DNSへ切り替える/));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/切り替え先の公開DNS/), "1.1.1.1");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("保存時、各リストは空行・前後の空白を除いて送信する", async () => {
    await renderDialog({
      dnsRelayEnabled: true,
      dnsUpstreamUrl: "  https://dns.home.example/dns-query ",
      dnsFailureMode: "fallback",
      dnsFallbackServers: ["1.1.1.1", "", " 9.9.9.9 "],
      dnsClientNameServers: [" 192.168.3.254 ", ""],
      dnsRedirectEnabled: true,
      dnsRedirectExcludedCidrs: ["192.168.3.5/32", ""],
      excludedDomains: ["example.com", "  ", "*.example.com "],
    });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.putV1ConnectionConfig).toHaveBeenCalled());
    expect(api.putV1ConnectionConfig.mock.calls[0][0]).toMatchObject({
      excludedDomains: ["example.com", "*.example.com"],
      dnsUpstreamUrl: "https://dns.home.example/dns-query",
      dnsFallbackServers: ["1.1.1.1", "9.9.9.9"],
      dnsClientNameServers: ["192.168.3.254"],
      dnsRedirectExcludedCidrs: ["192.168.3.5/32"],
      dnsFailureMode: "fallback",
    });
  });
});
