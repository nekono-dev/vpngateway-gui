// 責務: ダッシュボードの状態の取得・実行可否による部品の制御・ベンダーの選択・エラー通知の受け入れテスト。
// 受け入れ条件 webserver/AC-5〜AC-8・AC-20・AC-25 を、APIクライアントをモックした実際の画面（App）で確認する。

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilities, createApiMocks, gatewayStatus, installDashboardDefaults, location, provider } from "./fixtures";

const api = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../../web/src/generated/api/default/default", async () => {
  const { createApiMocks: create } = await import("./fixtures");
  Object.assign(api, create(() => vi.fn()));
  return api;
});

const { App } = await import("../../web/src/App");
const { ToastProvider } = await import("../../web/src/notifications/ToastProvider");

const mocks = () => api as unknown as ReturnType<typeof createApiMocks>;

function renderApp() {
  return render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
}

const TWO_PROVIDERS = [provider("adguardvpn", "AdGuard VPN", { active: true }), provider("protonvpn", "Proton VPN")];

beforeEach(() => {
  installDashboardDefaults(mocks());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("状態の取得と表示", () => {
  it("webserver/AC-5: 接続状態と稼働状況の取得は独立しており、片方が失敗してももう片方を表示し続ける", async () => {
    // 稼働状況の取得だけが失敗しても、接続状態は表示される。
    api.getV1ConnectionGateway.mockResolvedValue({ status: 502, data: { error: "proxy_unavailable" } });
    const first = renderApp();
    expect(await screen.findByText("切断")).toBeInTheDocument();
    expect(await screen.findByText(/稼働状況の取得に失敗しました \(status: 502\)/)).toBeInTheDocument();
    first.unmount();

    // 接続状態の取得だけが失敗しても、稼働状況は表示され続ける。
    api.getV1ConnectionGateway.mockResolvedValue(gatewayStatus);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp();
    expect(await screen.findByText("稼働中")).toBeInTheDocument();
    api.getV1Connection.mockResolvedValue({ status: 422, data: { error: "command_failed" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByText(/接続状態の取得に失敗しました \(status: 422\)/)).toBeInTheDocument();
    expect(screen.getByText("稼働中")).toBeInTheDocument();
  });

  it("webserver/AC-20: 状態は5秒ごとに取得され、接続先リストは時間が経っても再取得されない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp();
    expect(await screen.findByRole("radio", { name: /Tokyo/ })).toBeInTheDocument();
    const connectionCalls = () => api.getV1Connection.mock.calls.length;
    const locationCalls = api.getV1ConnectionLocations.mock.calls.length;
    const base = connectionCalls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4900);
    });
    expect(connectionCalls()).toBe(base);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(connectionCalls()).toBe(base + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(connectionCalls()).toBeGreaterThanOrEqual(base + 3);
    expect(api.getV1ConnectionLocations.mock.calls.length).toBe(locationCalls);
  });
});

describe("実行可否による制御", () => {
  it("webserver/AC-6: 実行できない操作は部品を残したまま無効になり、APIが返す理由文が表示される", async () => {
    const message = "無料プランでは接続先を選べません。最速の無料サーバへ自動接続します。";
    api.getV1ConnectionCapabilities.mockResolvedValue(
      capabilities({
        connectToLocation: { available: false, reason: "planRestricted", message },
        locationList: { available: false, reason: "planRestricted", message },
        locationFavorites: { available: false, reason: "planRestricted", message },
        pingMeasurement: { available: false, reason: "planRestricted", message },
        connectAuto: { available: true },
      }),
    );
    renderApp();
    // 理由文はAPIの文をそのまま表示し、接続先の一覧は取得も表示もしない。
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Tokyo/ })).not.toBeInTheDocument();
    expect(api.getV1ConnectionLocations).not.toHaveBeenCalled();
    // 指定なしの接続が可なので、［接続］は残り、押せる。
    expect(await screen.findByRole("button", { name: "接続" })).toBeEnabled();
  });

  it("webserver/AC-6: 切断が不可のときは、［切断］が残ったまま無効になり、理由が支援技術から辿れる", async () => {
    api.getV1Connection.mockResolvedValue({ status: 200, data: { status: "connected", location: "TOKYO", locationId: "jp-tokyo", country: "jp" } });
    api.getV1ConnectionCapabilities.mockResolvedValue(
      capabilities({ disconnect: { available: false, reason: "unsupported", message: "このVPNプロバイダでは利用できません" } }),
    );
    renderApp();
    const button = await screen.findByRole("button", { name: "切断" });
    expect(button).toBeDisabled();
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(button.getAttribute("aria-describedby") as string)).toHaveTextContent("このVPNプロバイダでは利用できません");
  });
});

describe("ベンダーの選択", () => {
  beforeEach(() => {
    api.getV1Providers.mockResolvedValue({ status: 200, data: TWO_PROVIDERS });
  });

  it("webserver/AC-7: 利用不可のベンダーは選べず、接続中の切替は確認を経て、承諾されたときだけ切り替わる", async () => {
    api.getV1Providers.mockResolvedValue({
      status: 200,
      data: [TWO_PROVIDERS[0], provider("protonvpn", "Proton VPN", { available: false, unavailableReason: "ランナーが起動していません" })],
    });
    const first = renderApp();
    const unavailable = await screen.findByRole("option", { name: /Proton VPN/ });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveTextContent("ランナーが起動していません");
    first.unmount();

    // 接続中の切替: 確認を拒否したら何も要求せず、承諾したときだけ切り替える。
    api.getV1Providers.mockResolvedValue({ status: 200, data: TWO_PROVIDERS });
    api.getV1Connection.mockResolvedValue({ status: 200, data: { status: "connected", location: "TOKYO", locationId: "jp-tokyo", country: "jp" } });
    api.putV1ProvidersActive.mockResolvedValue({ status: 200, data: { id: "protonvpn", displayName: "Proton VPN" } });
    const confirm = vi.spyOn(window, "confirm");
    renderApp();
    const select = await screen.findByRole("combobox", { name: "VPNベンダー" });
    await waitFor(() => expect(document.querySelector("strong.connection-label")).toHaveTextContent("接続中"));
    confirm.mockReturnValueOnce(false);
    await userEvent.selectOptions(select, "protonvpn");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toContain("切断");
    expect(confirm.mock.calls[0]?.[0]).toContain("Kill Switch");
    expect(api.putV1ProvidersActive).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    await userEvent.selectOptions(select, "protonvpn");
    await waitFor(() => expect(api.putV1ProvidersActive).toHaveBeenCalledWith({ providerId: "protonvpn" }));
  });

  it("webserver/AC-8: ベンダーが切り替わると、接続先の選択と一覧が新しいベンダーのものへ入れ替わる", async () => {
    api.putV1ProvidersActive.mockResolvedValue({ status: 200, data: { id: "protonvpn", displayName: "Proton VPN" } });
    renderApp();
    await userEvent.click(await screen.findByRole("radio", { name: /Tokyo/ }));
    expect(screen.getByRole("radio", { name: /Tokyo/ })).toBeChecked();

    // 切替後は、新しいベンダーの一覧と状態が返る。
    api.getV1Providers.mockResolvedValue({ status: 200, data: [{ ...TWO_PROVIDERS[0], active: false }, { ...TWO_PROVIDERS[1], active: true }] });
    api.getV1ConnectionLocations.mockResolvedValue({
      status: 200,
      data: [location("us-united-states", "us", "United States", "", 0, { pingMs: undefined })],
    });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "VPNベンダー" }), "protonvpn");
    expect(await screen.findByRole("radio", { name: /United States/ })).toBeInTheDocument();
    // 前のベンダーの接続先と、選択は引き継がれない。
    expect(screen.queryByRole("radio", { name: /Tokyo/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /United States/ })).not.toBeChecked();
  });
});

describe("エラーの通知", () => {
  it("webserver/AC-25: エラーは要約だけが通常表示され、生の出力は詳細の折りたたみの中にだけある", async () => {
    api.putV1Connection.mockResolvedValue({
      status: 422,
      data: { error: "command_failed", exitCode: 1, stderr: "Error: raw-cli-output-should-be-collapsed" },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("radio", { name: /Tokyo/ }));
    await userEvent.click(screen.getByRole("button", { name: "接続" }));
    const toast = await screen.findByRole("alert");
    // 通常表示は要約（操作名と原因の種別）。
    expect(toast).toHaveTextContent("接続に失敗しました（VPNコマンドが異常終了: exit code 1）");
    // 生の出力は、閉じた状態の詳細の中にだけある。
    const details = toast.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("raw-cli-output-should-be-collapsed");
    const outside = within(toast).queryAllByText(/raw-cli-output-should-be-collapsed/).filter((element) => !details?.contains(element));
    expect(outside).toEqual([]);
  });
});
