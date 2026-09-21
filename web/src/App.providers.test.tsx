// 責務: VPNベンダーの選択（Phase 11）に対するダッシュボード全体（App）のコンポーネントテスト。
// 生成APIクライアントをモックし、選択部品の表示（1つのときは名前のみ）・切替（接続中は確認）・利用不可の無効化・
// 切替失敗の通知・切替後の画面の入れ替え（接続先リストの取り直し）を検証する。

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getV1Connection: vi.fn(),
  putV1Connection: vi.fn(),
  getV1ConnectionLocations: vi.fn(),
  putV1ConnectionLocationsLocationIdFavorite: vi.fn(),
  deleteV1ConnectionLocationsLocationIdFavorite: vi.fn(),
  getV1ConnectionGateway: vi.fn(),
  getV1ConnectionCapabilities: vi.fn(),
  getV1Providers: vi.fn(),
  putV1ProvidersActive: vi.fn(),
  getV1Session: vi.fn(),
  postV1Session: vi.fn(),
  deleteV1Session: vi.fn(),
  getV1ConnectionConfig: vi.fn(),
  putV1ConnectionConfig: vi.fn(),
  getV1ConnectionLog: vi.fn(),
}));
vi.mock("./generated/api/default/default", () => api);

const { App } = await import("./App");
const { ToastProvider } = await import("./notifications/ToastProvider");

const provider = (id: string, displayName: string, extra = {}) => ({ id, displayName, active: false, available: true, ...extra });
const TWO = [provider("adguardvpn", "AdGuard VPN", { active: true }), provider("protonvpn", "Proton VPN")];
const ok = { available: true };
const capabilities = {
  status: 200,
  data: {
    capabilities: {
      login: ok, logout: ok, connectToLocation: ok, connectAuto: ok, changeLocation: ok, disconnect: ok,
      locationList: ok, locationFavorites: ok, pingMeasurement: ok,
    },
  },
};
const LOCATIONS = [{ id: "jp-tokyo", country: "jp", countryName: "Japan", city: "Tokyo", pingMs: 4, favorite: false, lastConnected: false }];

function renderApp() {
  return render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
}

describe("App（VPNベンダーの選択）", () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getV1Connection.mockResolvedValue({ status: 200, data: { status: "disconnected" } });
    api.getV1ConnectionGateway.mockResolvedValue({
      status: 200,
      data: { transparentGateway: { state: "stopped", killSwitchBlocking: false }, explicitProxy: { state: "stopped", restartCount: 0 } },
    });
    api.getV1ConnectionLocations.mockResolvedValue({ status: 200, data: LOCATIONS });
    api.getV1ConnectionCapabilities.mockResolvedValue(capabilities);
    api.getV1Session.mockResolvedValue({ status: 200, data: { loginMethod: "deviceUrl" } });
    api.getV1Providers.mockResolvedValue({ status: 200, data: TWO });
  });

  it("有効なベンダーが1つのときは選択肢を出さず名前だけを表示し、状態カードにベンダー名を付けない", async () => {
    api.getV1Providers.mockResolvedValue({ status: 200, data: [TWO[0]] });
    renderApp();
    expect(await screen.findByText("AdGuard VPN")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "VPNベンダー" })).not.toBeInTheDocument();
    expect(screen.queryByText("（AdGuard VPN）")).not.toBeInTheDocument();
  });

  it("ベンダー一覧を取得できない場合は選択部品を出さず、従来どおり操作できる（後方互換）", async () => {
    api.getV1Providers.mockRejectedValue(new Error("not found"));
    renderApp();
    expect(await screen.findByRole("radio", { name: /Tokyo/ })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "VPNベンダー" })).not.toBeInTheDocument();
  });

  it("複数のときは選択部品（選択中が分かる）と、状態カードのベンダー名を表示する", async () => {
    renderApp();
    const group = await screen.findByRole("radiogroup", { name: "VPNベンダー" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "AdGuard VPN" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Proton VPN" })).not.toBeChecked();
    expect(await screen.findByText("（AdGuard VPN）")).toBeInTheDocument();
  });

  it("利用不可のベンダーは理由付きで選択できない", async () => {
    api.getV1Providers.mockResolvedValue({
      status: 200,
      data: [TWO[0], provider("protonvpn", "Proton VPN", { available: false, unavailableReason: "ランナーが起動していません" })],
    });
    renderApp();
    const radio = await screen.findByRole("radio", { name: /Proton VPN/ });
    expect(radio).toBeDisabled();
    expect(screen.getByText(/利用不可: ランナーが起動していません/)).toBeInTheDocument();
  });

  it("切断中の切替は確認なしで要求し、成功後に状態と接続先リストを新しいベンダーのものへ入れ替える", async () => {
    api.putV1ProvidersActive.mockResolvedValue({ status: 200, data: { id: "protonvpn", displayName: "Proton VPN" } });
    const confirm = vi.spyOn(window, "confirm");
    renderApp();
    await screen.findByRole("radio", { name: /Tokyo/ });
    const callsBefore = api.getV1ConnectionLocations.mock.calls.length;

    // 切替後は、新しいベンダーの一覧・状態が返る。
    api.getV1Providers.mockResolvedValue({ status: 200, data: [{ ...TWO[0], active: false }, { ...TWO[1], active: true }] });
    api.getV1ConnectionLocations.mockResolvedValue({
      status: 200,
      data: [{ id: "us-united-states", country: "us", countryName: "United States", favorite: false, lastConnected: false }],
    });
    await userEvent.click(screen.getByRole("radio", { name: "Proton VPN" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(api.putV1ProvidersActive).toHaveBeenCalledWith({ providerId: "protonvpn" });
    expect(await screen.findByText("Proton VPNへ切り替えました")).toBeInTheDocument();
    // 前のベンダーの接続先は消え、新しいベンダーの接続先が取得し直される。
    expect(await screen.findByRole("radio", { name: /United States/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Tokyo/ })).not.toBeInTheDocument();
    expect(api.getV1ConnectionLocations.mock.calls.length).toBeGreaterThan(callsBefore);
    confirm.mockRestore();
  });

  it("接続中の切替は確認ダイアログを出し、拒否したら何も要求しない。承諾したら要求する", async () => {
    api.getV1Connection.mockResolvedValue({ status: 200, data: { status: "connected", location: "TOKYO", locationId: "jp-tokyo", country: "jp" } });
    api.putV1ProvidersActive.mockResolvedValue({ status: 200, data: { id: "protonvpn", displayName: "Proton VPN" } });
    const confirm = vi.spyOn(window, "confirm");
    renderApp();
    const target = await screen.findByRole("radio", { name: "Proton VPN" });
    await waitFor(() => expect(document.querySelector("strong.connection-label")).toHaveTextContent("接続中"));

    confirm.mockReturnValueOnce(false);
    await userEvent.click(target);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("切断");
    expect(confirm.mock.calls[0][0]).toContain("Kill Switch");
    expect(api.putV1ProvidersActive).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await userEvent.click(target);
    await waitFor(() => expect(api.putV1ProvidersActive).toHaveBeenCalledWith({ providerId: "protonvpn" }));
    confirm.mockRestore();
  });

  it("切替に失敗（切断失敗の422）したら原因をトーストで通知する", async () => {
    api.putV1ProvidersActive.mockResolvedValue({ status: 422, data: { error: "command_failed", exitCode: 1, stderr: "Failed to disconnect" } });
    renderApp();
    await userEvent.click(await screen.findByRole("radio", { name: "Proton VPN" }));
    expect(await screen.findByText(/ベンダーの切替に失敗しました（VPNコマンドが異常終了: exit code 1）/)).toBeInTheDocument();
  });

  it("切替中に他のベンダー操作が競合（409）した場合は、切替中であることを通知する", async () => {
    api.getV1Connection.mockResolvedValue({ status: 200, data: { status: "disconnected" } });
    api.putV1Connection.mockResolvedValue({ status: 409, data: { error: "provider_switching" } });
    renderApp();
    await userEvent.click(await screen.findByRole("radio", { name: /Tokyo/ }));
    await userEvent.click(screen.getByRole("button", { name: "接続" }));
    expect(await screen.findByText(/ベンダーの切替中です/)).toBeInTheDocument();
  });
});
