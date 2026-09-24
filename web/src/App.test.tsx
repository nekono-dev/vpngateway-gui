// 責務: ダッシュボード全体（App）のコンポーネントテスト。生成APIクライアントをモックし、
// 接続先リストからの接続・接続先変更・切断、接続国の表示、エラートースト、稼働状況表示、
// ゲートウェイ取得失敗の分離を検証する。

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
  getV1ConnectionConfig: vi.fn(),
  putV1ConnectionConfig: vi.fn(),
  getV1ConnectionLog: vi.fn(),
  postV1Session: vi.fn(),
}));
vi.mock("./generated/api/default/default", () => api);

const { App } = await import("./App");
const { ToastProvider } = await import("./notifications/ToastProvider");

const disconnected = { status: 200, data: { status: "disconnected" } };
const connectedJp = { status: 200, data: { status: "connected", country: "jp", location: "TOKYO", locationId: "jp-tokyo" } };
// APIはping昇順で返す。lastConnectedは各テストで必要なときだけ立てる。
const location = (id: string, country: string, countryName: string, city: string, pingMs: number, extra = {}) => ({
  id, country, countryName, city, pingMs, favorite: false, lastConnected: false, ...extra,
});
const LOCATIONS = [
  location("jp-tokyo", "jp", "Japan", "Tokyo", 4),
  location("kr-seoul", "kr", "South Korea", "Seoul", 28),
  location("us-las-vegas", "us", "United States", "Las Vegas", 111),
];
const gatewayActive = {
  status: 200,
  data: {
    transparentGateway: { state: "active", vpnInterface: "tun0", killSwitchBlocking: false },
    explicitProxy: { state: "stopped", restartCount: 0 },
  },
};

function renderApp() {
  return render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
}

/** 接続先リストで、都市名を含む行を選択する。 */
async function selectLocation(city: RegExp | string) {
  await userEvent.click(await screen.findByRole("radio", { name: city }));
}

describe("App", () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getV1Connection.mockResolvedValue(disconnected);
    api.getV1ConnectionLocations.mockResolvedValue({ status: 200, data: LOCATIONS });
    api.getV1ConnectionGateway.mockResolvedValue({
      status: 200,
      data: {
        transparentGateway: { state: "stopped", killSwitchBlocking: false },
        explicitProxy: { state: "stopped", restartCount: 0 },
      },
    });
  });

  it("接続状態と透過ゲートウェイ・明示的プロキシの稼働状況を初回ロードで表示する", async () => {
    renderApp();
    expect(await screen.findByText("切断")).toBeInTheDocument();
    // 両方とも停止のため「停止」が2つ表示される（各行の実状態）。
    expect(await screen.findAllByText("停止")).toHaveLength(2);
    expect(screen.queryByText(/未対応（Phase 4で対応予定）/)).not.toBeInTheDocument();
  });

  it("リストで選択した接続先へlocationIdで接続し、APIが返す接続国（と接続先）を表示、切断で消える", async () => {
    api.putV1Connection.mockResolvedValueOnce({ status: 200, data: { status: "connected", country: "us", location: "LAS VEGAS", locationId: "us-las-vegas" } });
    renderApp();
    await screen.findByText("切断");
    await selectLocation(/Las Vegas/);

    api.getV1Connection.mockResolvedValue({ status: 200, data: { status: "connected", country: "us", location: "LAS VEGAS", locationId: "us-las-vegas" } });
    await userEvent.click(screen.getByRole("button", { name: "接続" }));

    expect(api.putV1Connection).toHaveBeenCalledWith({ connect: true, locationId: "us-las-vegas" });
    expect(await screen.findByText(/接続国: US \/ LAS VEGAS/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("接続しました");
    // 接続後はリストの該当行に「接続中」「前回」バッジが付く
    const row = screen.getByRole("radio", { name: /Las Vegas/ }).closest("li")!;
    expect(row).toHaveTextContent("接続中");
    expect(row).toHaveTextContent("前回");

    api.putV1Connection.mockResolvedValueOnce({ status: 200, data: { status: "disconnected" } });
    api.getV1Connection.mockResolvedValue(disconnected);
    await userEvent.click(screen.getByRole("button", { name: "切断" }));
    await waitFor(() => expect(screen.queryByText(/接続国:/)).not.toBeInTheDocument());
    // 切断後も「前回」は残る
    expect(screen.getByRole("radio", { name: /Las Vegas/ }).closest("li")).toHaveTextContent("前回");
  });

  it("接続先を選ばなくても、最後に接続した接続先が選択済みで、接続ボタンでその接続先へ接続する", async () => {
    api.getV1ConnectionLocations.mockResolvedValue({
      status: 200,
      data: [LOCATIONS[0], location("kr-seoul", "kr", "South Korea", "Seoul", 28, { lastConnected: true }), LOCATIONS[2]],
    });
    api.putV1Connection.mockResolvedValueOnce({ status: 200, data: { status: "connected", country: "kr", location: "SEOUL", locationId: "kr-seoul" } });
    renderApp();
    await screen.findByText("切断");
    expect(await screen.findByRole("radio", { name: /Seoul/ })).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "接続" }));
    expect(api.putV1Connection).toHaveBeenCalledWith({ connect: true, locationId: "kr-seoul" });
  });

  it("再読み込み（初回ロード）時点で接続中なら、APIが返す接続国を表示し、現在の接続先に「接続中」を付ける", async () => {
    // クライアントは接続操作の履歴を持たない。表示は完全にGET /v1/connectionの応答に依存する。
    api.getV1Connection.mockResolvedValue(connectedJp);
    renderApp();
    expect(await screen.findByText(/接続国: JP \/ TOKYO/)).toBeInTheDocument();
    expect((await screen.findByRole("radio", { name: /Tokyo/ })).closest("li")).toHaveTextContent("接続中");
  });

  it("接続中でも国が返らない場合（接続先が保存時と異なる等）は接続国を表示しない。都市名で現在の接続先を特定する", async () => {
    api.getV1Connection.mockResolvedValue({ status: 200, data: { status: "connected", location: "SEOUL" } });
    renderApp();
    expect(await screen.findByText("接続中", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText(/接続国:/)).not.toBeInTheDocument();
    expect((await screen.findByRole("radio", { name: /Seoul/ })).closest("li")).toHaveTextContent("接続中");
  });

  it("接続中は［切断］のみ。別の接続先を選ぶと［接続先を変更］が現れ、押すと選択した接続先へ切り替える", async () => {
    api.getV1Connection.mockResolvedValue(connectedJp);
    renderApp();
    await screen.findByText(/接続国: JP/);
    expect(screen.getByRole("button", { name: "切断" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "接続先を変更" })).not.toBeInTheDocument();

    // 現在の接続先を選び直しても［接続先を変更］は出ない
    await selectLocation(/Tokyo/);
    expect(screen.queryByRole("button", { name: "接続先を変更" })).not.toBeInTheDocument();

    await selectLocation(/Seoul/);
    expect(screen.getByRole("button", { name: "切断" })).toBeInTheDocument();
    api.putV1Connection.mockResolvedValueOnce({ status: 200, data: { status: "connected", country: "kr", location: "SEOUL", locationId: "kr-seoul" } });
    api.getV1Connection.mockResolvedValue({ status: 200, data: { status: "connected", country: "kr", location: "SEOUL", locationId: "kr-seoul" } });
    await userEvent.click(screen.getByRole("button", { name: "接続先を変更" }));

    expect(api.putV1Connection).toHaveBeenCalledWith({ connect: true, locationId: "kr-seoul" });
    expect(screen.getByRole("status")).toHaveTextContent("接続先を変更しました");
    expect(await screen.findByText(/接続国: KR \/ SEOUL/)).toBeInTheDocument();
    // 変更後は現在の接続先が実効選択に戻り、［接続先を変更］は消える
    await waitFor(() => expect(screen.queryByRole("button", { name: "接続先を変更" })).not.toBeInTheDocument());
  });

  it("★でお気に入りへ追加でき、「お気に入り」タブにping昇順で出る。API失敗時は元に戻してトースト通知する", async () => {
    api.putV1ConnectionLocationsLocationIdFavorite.mockResolvedValue({ status: 200, data: { locationId: "us-las-vegas", favorite: true } });
    renderApp();
    await screen.findByRole("radio", { name: /Tokyo/ });

    await userEvent.click(screen.getByRole("button", { name: "Las Vegasをお気に入りに追加" }));
    await userEvent.click(screen.getByRole("button", { name: "Seoulをお気に入りに追加" }));
    expect(api.putV1ConnectionLocationsLocationIdFavorite).toHaveBeenCalledWith("us-las-vegas");
    expect(api.putV1ConnectionLocationsLocationIdFavorite).toHaveBeenCalledWith("kr-seoul");

    await userEvent.click(screen.getByRole("tab", { name: /お気に入り/ }));
    const names = screen.getAllByRole("radio").map((radio) => radio.closest("li")!.textContent);
    expect(names).toHaveLength(2);
    expect(names[0]).toContain("Seoul"); // 28ms
    expect(names[1]).toContain("Las Vegas"); // 111ms

    api.deleteV1ConnectionLocationsLocationIdFavorite.mockResolvedValue({ status: 500, data: {} });
    await userEvent.click(screen.getByRole("button", { name: "Seoulのお気に入りを解除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("お気に入りの解除に失敗しました");
    expect(screen.getByRole("button", { name: "Seoulのお気に入りを解除" })).toBeInTheDocument(); // 元に戻っている
  });

  it("再計測で一覧を再取得し、ping値が更新される", async () => {
    renderApp();
    await screen.findByRole("radio", { name: /Seoul/ });
    expect(api.getV1ConnectionLocations).toHaveBeenCalledTimes(1);

    api.getV1ConnectionLocations.mockResolvedValue({
      status: 200,
      data: [location("kr-seoul", "kr", "South Korea", "Seoul", 3), LOCATIONS[0], LOCATIONS[2]],
    });
    await userEvent.click(screen.getByRole("button", { name: "再計測" }));
    await waitFor(() => expect(screen.getAllByRole("radio")[0].closest("li")).toHaveTextContent("Seoul"));
    expect(screen.getAllByRole("radio")[0].closest("li")).toHaveTextContent("3 ms");
    expect(api.getV1ConnectionLocations).toHaveBeenCalledTimes(2);
  });

  it("接続先が無い（一覧が空・最後の接続先も無い）間は［接続］を押せない", async () => {
    renderApp();
    await screen.findByText("切断");
    await screen.findByRole("radio", { name: /Tokyo/ });
    expect(screen.getByRole("button", { name: "接続" })).toBeDisabled();
    expect(api.putV1Connection).not.toHaveBeenCalled();
  });

  it("接続先の取得に失敗するとリスト領域にエラーと再取得ボタンを出し、接続は不可・切断は可。再取得で回復する", async () => {
    api.getV1ConnectionLocations.mockResolvedValueOnce({
      status: 422,
      data: { error: "command_failed", exitCode: 11, stderr: "You are not logged in" },
    });
    api.getV1Connection.mockResolvedValue(connectedJp);
    renderApp();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("接続先の取得に失敗しました（VPNコマンドが異常終了: exit code 11）");
    expect(alert.querySelector("details")).toHaveTextContent("You are not logged in");
    expect(screen.getByRole("button", { name: "切断" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "再取得" }));
    expect(await screen.findByRole("radio", { name: /Tokyo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再取得" })).not.toBeInTheDocument();
  });

  it("422は要約をトースト表示し、stderrは折りたたみの詳細に入る", async () => {
    api.putV1Connection.mockResolvedValueOnce({
      status: 422,
      data: { error: "command_failed", exitCode: 1, stderr: "Error: not logged in" },
    });
    renderApp();
    await screen.findByText("切断");
    await selectLocation(/Las Vegas/);
    await userEvent.click(screen.getByRole("button", { name: "接続" }));

    const toast = await screen.findByRole("alert");
    expect(toast).toHaveTextContent("接続に失敗しました（VPNコマンドが異常終了: exit code 1）");
    const details = toast.querySelector("details");
    expect(details).toHaveTextContent("Error: not logged in");
    expect(details).not.toHaveAttribute("open");
  });

  it("502（プロキシ未応答）は要約をトースト表示する", async () => {
    api.putV1Connection.mockResolvedValueOnce({ status: 502, data: { error: "proxy_unavailable", message: "failed to connect" } });
    renderApp();
    await screen.findByText("切断");
    await selectLocation(/Tokyo/);
    await userEvent.click(screen.getByRole("button", { name: "接続" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("プロキシサーバに接続できません");
  });

  it("通信自体の失敗（fetch例外）もトースト表示し、二重送信防止が解除される", async () => {
    api.putV1Connection.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderApp();
    await screen.findByText("切断");
    await selectLocation(/Tokyo/);
    await userEvent.click(screen.getByRole("button", { name: "接続" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("APIサーバに接続できません");
    expect(screen.getByRole("button", { name: "接続" })).toBeEnabled();
  });

  it("稼働状況の取得失敗は接続状態の表示を妨げない", async () => {
    api.getV1ConnectionGateway.mockResolvedValue({ status: 502, data: { error: "proxy_unavailable" } });
    renderApp();
    expect(await screen.findByText("切断")).toBeInTheDocument();
    expect(await screen.findByText(/稼働状況の取得に失敗しました \(status: 502\)/)).toBeInTheDocument();
  });

  it("接続状態の取得失敗でも稼働状況は表示し、接続操作ボタンは最後の既知状態で使える", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderApp();
      await screen.findByText("切断");
      await screen.findAllByText("停止");

      api.getV1Connection.mockResolvedValue({ status: 422, data: { error: "command_failed" } });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await screen.findByText(/接続状態の取得に失敗しました \(status: 422\)/)).toBeInTheDocument();
      expect(screen.getAllByText("停止")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("proxy障害で両方の取得が失敗したら、稼働状況は古い値を残さず取得失敗を表示する", async () => {
    api.getV1ConnectionGateway.mockResolvedValue(gatewayActive);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderApp();
      await screen.findByText("稼働中");

      api.getV1Connection.mockResolvedValue({ status: 502, data: { error: "proxy_unavailable" } });
      api.getV1ConnectionGateway.mockResolvedValue({ status: 502, data: { error: "proxy_unavailable" } });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await screen.findByText(/稼働状況の取得に失敗しました \(status: 502\)/)).toBeInTheDocument();
      expect(screen.queryByText("稼働中")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("稼働状況はポーリングで実際の状態に追従する（Kill Switch遮断→稼働中）", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.getV1ConnectionGateway.mockResolvedValue({
        status: 200,
        data: {
          transparentGateway: { state: "active", killSwitchBlocking: true },
          explicitProxy: { state: "stopped", restartCount: 0 },
        },
      });
      renderApp();
      expect(await screen.findByText("Kill Switchにより遮断中（VPN未接続）")).toBeInTheDocument();

      api.getV1ConnectionGateway.mockResolvedValue(gatewayActive);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await screen.findByText("稼働中")).toBeInTheDocument();
      expect(screen.getByText(/VPN IF: tun0/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("接続ログ・設定ボタンでそれぞれのダイアログが開き、DNS中継の設定グループが出る", async () => {
    api.getV1ConnectionLog.mockResolvedValue({ status: 200, data: [] });
    api.getV1ConnectionConfig.mockResolvedValue({
      status: 200,
      data: {
        killSwitch: true,
        excludedDomains: [],
        transparentGatewayEnabled: true,
        explicitProxyEnabled: false,
        explicitProxyAllowedCidrs: [],
        dnsRelayEnabled: false,
        dnsUpstreamUrl: "",
        dnsUpstreamCaPem: "",
        dnsFailureMode: "failClosed",
        dnsFallbackServers: [],
        dnsRedirectEnabled: false,
        dnsRedirectExcludedCidrs: [],
      },
    });
    renderApp();
    await screen.findByText("切断");

    await userEvent.click(screen.getByRole("button", { name: "接続ログ" }));
    expect(await screen.findByText("履歴はありません。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(await screen.findByText("DNS中継")).toBeInTheDocument();
    // 迂回ドメインの「未対応」の暫定表示はPhase 14で除去した。
    expect(screen.queryByText(/未対応/)).not.toBeInTheDocument();
    // Phase 8でデフォルト接続国は廃止した
    expect(screen.queryByText("デフォルト接続国")).not.toBeInTheDocument();
  });
});
