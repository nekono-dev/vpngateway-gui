// 責務: 設定ダイアログ（SettingsDialog）のうち、Phase 14で加えた迂回ドメイン・DNS中継の入力（表示・保存前チェック・送信内容）のテスト。

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
  dnsRedirectEnabled: false,
  dnsRedirectExcludedCidrs: [] as string[],
};

async function renderDialog(overrides: Partial<typeof BASE_SETTINGS> = {}) {
  api.getV1ConnectionConfig.mockResolvedValue({ status: 200, data: { ...BASE_SETTINGS, ...overrides } });
  render(<SettingsDialog open onClose={() => undefined} />);
  await screen.findByText("DNS中継");
}

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
    await userEvent.click(screen.getByLabelText(/DNS中継を有効にする/));
    expect(screen.queryByText("DNS中継が無効なため、迂回ドメインは反映されません。")).not.toBeInTheDocument();
  });

  it("DNS中継が無効の間は、上流・失敗時の挙動・リダイレクトの入力欄を無効化する", async () => {
    await renderDialog();
    expect(screen.getByLabelText(/自宅DNSサーバ（DoHのURL）/)).toBeDisabled();
    expect(screen.getByLabelText(/公開DNSへ切り替える/)).toBeDisabled();
    expect(screen.getByLabelText(/手動でDNSを指定した端末/)).toBeDisabled();
  });

  it("DNS中継を有効にしたのに上流もフォールバック先も空なら、保存できず理由を示す", async () => {
    await renderDialog();
    await userEvent.click(screen.getByLabelText(/DNS中継を有効にする/));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByText(/自宅DNSサーバのURLか、切り替え先の公開DNSを入力/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/自宅DNSサーバ（DoHのURL）/), "https://dns.home.example/dns-query");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("「公開DNSへ切り替える」を選ぶと、切り替え先が空の間は保存できない", async () => {
    await renderDialog({ dnsRelayEnabled: true, dnsUpstreamUrl: "https://dns.home.example/dns-query" });
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
      dnsRedirectExcludedCidrs: ["192.168.3.5/32"],
      dnsFailureMode: "fallback",
    });
  });
});
