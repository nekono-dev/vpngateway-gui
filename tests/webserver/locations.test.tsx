// 責務: 接続先リスト（表示・タブ・絞り込み・お気に入り・選択）、接続・接続先の変更・切断の操作、参考の一覧の受け入れテスト。
// 受け入れ条件 webserver/AC-11〜AC-13・AC-22 を、APIクライアントをモックした実際の画面（App）で確認する。

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { capabilities, createApiMocks, installDashboardDefaults, LOCATIONS } from "./fixtures";

const api = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../../web/src/generated/api/default/default", async () => {
  const { createApiMocks: create } = await import("./fixtures");
  Object.assign(api, create(() => vi.fn()));
  return api;
});

const { App } = await import("../../web/src/App");
const { ToastProvider } = await import("../../web/src/notifications/ToastProvider");

const mocks = () => api as unknown as ReturnType<typeof createApiMocks>;
const connectedTokyo = { status: 200, data: { status: "connected", country: "jp", location: "TOKYO", locationId: "jp-tokyo" } };

/** 目的: ダッシュボードを描画し、ベンダーの一覧の取得（接続操作の部品の再マウント）が済むまで待つ。 */
async function renderDashboard(): Promise<void> {
  render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
  await screen.findByText("AdGuard VPN");
  await screen.findByRole("radio", { name: /Tokyo/ });
}

beforeEach(() => {
  installDashboardDefaults(mocks());
});

describe("接続先リスト", () => {
  it("webserver/AC-11: 接続先は応答時間の順に並び、タブと絞り込みで表示を切り替えられ、お気に入りを登録・解除できる", async () => {
    api.putV1ConnectionLocationsLocationIdFavorite.mockResolvedValue({ status: 200, data: { favorite: true } });
    api.deleteV1ConnectionLocationsLocationIdFavorite.mockResolvedValue({ status: 200, data: { favorite: false } });
    await renderDashboard();
    // APIが返した順（応答時間の昇順）のまま表示し、応答時間も示す。Webでは並べ替えない。
    const names = screen.getAllByRole("radio").map((radio) => radio.closest("label")?.textContent ?? "");
    expect(names.map((text) => /(Tokyo|Seoul|Las Vegas)/.exec(text)?.[1])).toEqual(["Tokyo", "Seoul", "Las Vegas"]);
    expect(names[0]).toContain("4 ms");

    // お気に入りがまだ無いタブでは、その旨を案内する。
    await userEvent.click(screen.getByRole("tab", { name: /^お気に入り/ }));
    expect(screen.getByText(/お気に入りはまだありません/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /^すべて/ }));

    // 登録は楽観的に反映され、お気に入りのタブに現れる。
    await userEvent.click(screen.getByRole("button", { name: "Seoulをお気に入りに追加" }));
    expect(api.putV1ConnectionLocationsLocationIdFavorite).toHaveBeenCalledWith("kr-seoul");
    expect(screen.getByRole("button", { name: "Seoulのお気に入りを解除" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("tab", { name: /^お気に入り/ }));
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /Seoul/ })).toBeInTheDocument();

    // 解除すると、お気に入りのタブから消える。
    await userEvent.click(screen.getByRole("button", { name: "Seoulのお気に入りを解除" }));
    expect(api.deleteV1ConnectionLocationsLocationIdFavorite).toHaveBeenCalledWith("kr-seoul");
    await waitFor(() => expect(screen.queryByRole("radio")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("tab", { name: /^すべて/ }));

    // 絞り込みは、大文字小文字を区別せず、並びを変えない。
    await userEvent.type(screen.getByRole("searchbox", { name: "接続先を絞り込み" }), "las");
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /Las Vegas/ })).toBeInTheDocument();
  });

  it("webserver/AC-12: 選択した接続先へ接続でき、接続中に別の接続先を選ぶと変更の操作が現れ、切断はいつでもできる", async () => {
    api.putV1Connection.mockResolvedValue(connectedTokyo);
    await renderDashboard();
    // 切断中: 未選択のあいだは接続できず、選んだ接続先へlocationIdで接続する。
    await userEvent.click(screen.getByRole("radio", { name: /Las Vegas/ }));
    api.getV1Connection.mockResolvedValue({ status: 200, data: { status: "connected", country: "us", location: "LAS VEGAS", locationId: "us-las-vegas" } });
    await userEvent.click(screen.getByRole("button", { name: "接続" }));
    expect(api.putV1Connection).toHaveBeenCalledWith({ connect: true, locationId: "us-las-vegas" });

    // 接続中: 現在の接続先を選んでいる間は変更の操作は無く、切断だけがある。別の接続先を選ぶと、変更の操作が現れる。
    expect(await screen.findByRole("button", { name: "切断" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "接続先を変更" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Seoul/ }));
    await userEvent.click(await screen.findByRole("button", { name: "接続先を変更" }));
    expect(api.putV1Connection).toHaveBeenLastCalledWith({ connect: true, locationId: "kr-seoul" });

    // 切断は、いつでもできる。
    api.putV1Connection.mockResolvedValue({ status: 200, data: { status: "disconnected" } });
    await userEvent.click(screen.getByRole("button", { name: "切断" }));
    expect(api.putV1Connection).toHaveBeenLastCalledWith({ connect: false });
  });

  it("webserver/AC-22: 送信中の接続操作は無効になり、二重に送信されない", async () => {
    // 応答を保留して、送信中の状態を作る。
    let finish: (value: unknown) => void = () => undefined;
    api.putV1Connection.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderDashboard();
    await userEvent.click(screen.getByRole("radio", { name: /Tokyo/ }));
    const button = screen.getByRole("button", { name: "接続" });
    await userEvent.click(button);
    expect(await screen.findByRole("button", { name: /処理中/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /処理中/ }));
    expect(api.putV1Connection).toHaveBeenCalledTimes(1);
    finish({ status: 200, data: { status: "connected", location: "TOKYO", locationId: "jp-tokyo", country: "jp" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: /処理中/ })).not.toBeInTheDocument());
  });
});

describe("参考の国・都市の一覧", () => {
  it("webserver/AC-13: 接続先を選べないプランでは、参考の一覧が選択できない行で表示され、現在の接続先が示される", async () => {
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
    api.getV1ConnectionAvailableLocations.mockResolvedValue({
      status: 200,
      data: {
        locations: [
          { code: "US", name: "アメリカ合衆国", cities: ["Ashburn", "Chicago"] },
          { code: "JP", name: "日本", cities: ["Tokyo"] },
        ],
      },
    });
    // 自動接続では、CLIが報告する接続先が「サーバ名 in 都市名, 国名」の形になる。
    api.getV1Connection.mockResolvedValue({ status: 200, data: { status: "connected", location: "US-FREE#5 in Chicago, United States" } });
    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );
    const group = await screen.findByRole("group", { name: "接続できる国（参考）" });
    expect(group).toHaveTextContent("アメリカ合衆国");
    expect(group).toHaveTextContent("日本");
    // 選択・お気に入りの操作はできない。接続先リストの一覧は取得しない。
    expect(group.querySelector("input, a")).toBeNull();
    for (const star of within(group).getAllByRole("button", { hidden: true })) expect(star).toBeDisabled();
    expect(api.getV1ConnectionLocations).not.toHaveBeenCalled();
    // 都市名が一致する国に「接続中」が付き、他の国には付かない。
    await waitFor(() => expect(within(group).getAllByText("接続中")).toHaveLength(1));
    expect(within(group).getByText("接続中").closest("li")).toHaveTextContent("アメリカ合衆国");
    expect(LOCATIONS).toHaveLength(3);
  });
});
