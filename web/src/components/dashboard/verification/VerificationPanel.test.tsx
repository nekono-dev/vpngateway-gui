// 責務: 設定ダイアログの「動作検証」タブ（VerificationPanel・useVerification）のテスト。実行・進行の表示・グループの折りたたみと
// 代表行・ブラウザ側の観測（出口IPの提出・検証用の名前の解決）・保存済みの設定で検証する旨の表示を検証する。APIとfetchは差し替える。

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getV1ConnectionConfig: vi.fn(),
  putV1ConnectionConfig: vi.fn(),
  putV1Operator: vi.fn(),
  postV1Verifications: vi.fn(),
  getV1VerificationsId: vi.fn(),
  putV1VerificationsIdClientObservationsEgressIp: vi.fn(),
}));
vi.mock("../../../generated/api/default/default", () => api);

const { SettingsDialog } = await import("../SettingsDialog");

const SETTINGS = {
  killSwitch: true,
  excludedDomains: ["*.bypass.example"],
  transparentGatewayEnabled: true,
  explicitProxyEnabled: false,
  explicitProxyAllowedCidrs: [] as string[],
  dnsRelayEnabled: true,
  dnsUpstreamUrl: "https://dns.home.example/dns-query",
  dnsUpstreamCaPem: "",
  dnsFailureMode: "failClosed",
  dnsFallbackServers: [] as string[],
  dnsClientNameServers: [] as string[],
  dnsRedirectEnabled: true,
  dnsRedirectExcludedCidrs: [] as string[],
  verifyEchoUrl: "https://echo.example",
};

type Status = "pending" | "running" | "pass" | "fail" | "unconfirmed" | "notApplicable";
function verification(state: "running" | "completed", statuses: Record<string, Status>, extra: Record<string, object> = {}) {
  const definitions: [string, string, "config" | "gateway" | "client"][] = [
    ["gateway-rules", "透過ゲートウェイの構成", "config"],
    ["explicit-proxy-listening", "明示的プロキシの待受", "config"],
    ["tunnel-egress", "VPN トンネルの出口 IP", "gateway"],
    ["bypass-routing", "迂回の経路", "gateway"],
    ["bypass-isolation", "迂回対象外ドメインが迂回されないこと", "gateway"],
    ["client-egress", "この端末の出口 IP", "client"],
  ];
  return {
    id: "11111111-1111-1111-1111-111111111111",
    state,
    startedAt: "2026-09-26T00:00:00.000Z",
    clientProbe: { dnsName: "vpngw-0123456789abcdef.example.com" },
    checks: definitions.map(([id, title, group]) => ({
      id,
      title,
      group,
      status: statuses[id] ?? "pending",
      ...(statuses[id] === "notApplicable" ? { reason: "明示的プロキシが無効のため" } : {}),
      ...(extra[id] ?? {}),
    })),
  };
}

const fetchMock = vi.fn();

async function openVerificationTab() {
  api.getV1ConnectionConfig.mockResolvedValue({ status: 200, data: SETTINGS });
  render(<SettingsDialog open onClose={() => undefined} />);
  await userEvent.click(await screen.findByRole("tab", { name: "動作検証" }));
}

describe("SettingsDialog: 動作検証タブ", () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "https://echo.example") return new Response("198.51.100.7\n");
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    api.putV1VerificationsIdClientObservationsEgressIp.mockResolvedValue({ status: 200, data: { accepted: true } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("実行前は「検証を実行」と3つのグループ（未実行）を表示する", async () => {
    await openVerificationTab();
    expect(screen.getByRole("button", { name: "検証を実行" })).toBeEnabled();
    for (const name of ["設定の確認", "ゲートウェイの通信確認", "この端末からの確認"]) {
      expect(within(screen.getByRole("region", { name })).getByText("未実行")).toBeInTheDocument();
    }
    expect(screen.getByLabelText("IP確認サービスのURL")).toHaveValue("https://echo.example");
  });

  it("実行中は、閉じたグループに実行中の項目だけを表示し、ボタンは無効（実行中 n/N）", async () => {
    api.postV1Verifications.mockResolvedValue({ status: 202, data: verification("running", { "explicit-proxy-listening": "notApplicable" }) });
    api.getV1VerificationsId.mockResolvedValue({
      status: 200,
      data: verification("running", {
        "gateway-rules": "pass",
        "explicit-proxy-listening": "notApplicable",
        "tunnel-egress": "fail",
        "bypass-routing": "running",
      }),
    });
    await openVerificationTab();
    await userEvent.click(screen.getByRole("button", { name: "検証を実行" }));

    const gateway = await screen.findByRole("region", { name: "ゲートウェイの通信確認" });
    await waitFor(() => expect(within(gateway).getByText("迂回の経路")).toBeInTheDocument());
    expect(within(gateway).getByText("確認中…")).toBeInTheDocument();
    // 閉じている間は、先に出たNGの項目は行として見えないが、件数バッジで分かる。
    expect(within(gateway).queryByText("VPN トンネルの出口 IP")).not.toBeInTheDocument();
    expect(within(gateway).getByText("NG 1")).toBeInTheDocument();
    expect(within(gateway).getByRole("button", { expanded: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /実行中 2\/5/ })).toBeDisabled();
    expect(within(screen.getByRole("region", { name: "設定の確認" })).getByText("すべてOK（1/1）")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "この端末からの確認" })).getByText("待機中（1項目）")).toBeInTheDocument();
  });

  it("開始直後に、ブラウザの出口IPを提出し、検証用の名前を解決させる（利用者の操作は不要）", async () => {
    api.postV1Verifications.mockResolvedValue({ status: 202, data: verification("running", {}) });
    api.getV1VerificationsId.mockResolvedValue({ status: 200, data: verification("completed", {}) });
    await openVerificationTab();
    await userEvent.click(screen.getByRole("button", { name: "検証を実行" }));
    await waitFor(() =>
      expect(api.putV1VerificationsIdClientObservationsEgressIp).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111", {
        ip: "198.51.100.7",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith("https://vpngw-0123456789abcdef.example.com/", expect.objectContaining({ mode: "no-cors" }));
  });

  it("IP確認サービスに接続できなければ、出口IPをnullで提出する", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    api.postV1Verifications.mockResolvedValue({ status: 202, data: verification("running", {}) });
    api.getV1VerificationsId.mockResolvedValue({ status: 200, data: verification("completed", {}) });
    await openVerificationTab();
    await userEvent.click(screen.getByRole("button", { name: "検証を実行" }));
    await waitFor(() => expect(api.putV1VerificationsIdClientObservationsEgressIp).toHaveBeenCalledWith(expect.any(String), { ip: null }));
  });

  it("完了後は要約を表示し、閉じたグループに最初のNG（期待・観測・対処）を代表として表示する。開くと全項目を表示する", async () => {
    const completed = verification(
      "completed",
      {
        "gateway-rules": "pass",
        "explicit-proxy-listening": "notApplicable",
        "tunnel-egress": "pass",
        "bypass-routing": "fail",
        "bypass-isolation": "unconfirmed",
        "client-egress": "unconfirmed",
      },
      {
        "tunnel-egress": { observed: "198.51.100.7（tun0 経由）" },
        "bypass-routing": { expected: "実回線へ送る", observed: "tun0 へ出る", hint: "設定を保存し直してください。" },
        "bypass-isolation": { reason: "共有されている" },
        "client-egress": { reason: "結果が届きませんでした。" },
      },
    );
    api.postV1Verifications.mockResolvedValue({ status: 202, data: verification("running", {}) });
    api.getV1VerificationsId.mockResolvedValue({ status: 200, data: completed });
    await openVerificationTab();
    await userEvent.click(screen.getByRole("button", { name: "検証を実行" }));

    expect(await screen.findByRole("button", { name: "もう一度実行" })).toBeEnabled();
    expect(screen.getByText("OK 2件")).toBeInTheDocument();
    expect(screen.getByText("NG 1件")).toBeInTheDocument();
    expect(screen.getByText("未確認 2件")).toBeInTheDocument();

    const gateway = screen.getByRole("region", { name: "ゲートウェイの通信確認" });
    expect(within(gateway).getByText("迂回の経路")).toBeInTheDocument();
    expect(within(gateway).getByText("tun0 へ出る")).toBeInTheDocument();
    expect(within(gateway).queryByText("迂回対象外ドメインが迂回されないこと")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "この端末からの確認" })).getByText("結果が届きませんでした。")).toBeInTheDocument();

    await userEvent.click(within(gateway).getByRole("button", { expanded: false }));
    expect(within(gateway).getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(within(gateway).getByText("VPN トンネルの出口 IP")).toBeInTheDocument();
    expect(within(gateway).getByText("198.51.100.7（tun0 経由）")).toBeInTheDocument();
    expect(within(gateway).getByText("迂回対象外ドメインが迂回されないこと")).toBeInTheDocument();

    expect(screen.getByText("対象外の項目（1件）")).toBeInTheDocument();
    expect(screen.getByText("明示的プロキシの待受（明示的プロキシが無効のため）")).toBeInTheDocument();
  });

  it("他で実行中（409）なら、その旨を表示する", async () => {
    api.postV1Verifications.mockResolvedValue({ status: 409, data: { error: "verification_running" } });
    await openVerificationTab();
    await userEvent.click(screen.getByRole("button", { name: "検証を実行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("他の画面で動作検証を実行中です");
  });

  it("未保存の変更があれば保存済みの設定で検証する旨を示し、URLが空なら保存できない", async () => {
    await openVerificationTab();
    const input = screen.getByLabelText("IP確認サービスのURL");
    await userEvent.clear(input);
    expect(screen.getByText(/保存済みの設定で検証します/)).toBeInTheDocument();
    expect(screen.getByText("IP確認サービスのURLを入力してください。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "動作検証 !" })).toBeInTheDocument();
  });
});
