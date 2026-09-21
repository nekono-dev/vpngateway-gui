// 責務: プロバイダの機能差・プラン制限（Phase 9）に対するダッシュボード全体（App）のコンポーネントテスト。
// 生成APIクライアントをモックし、無料版（接続先を選べない）・有料版・未ログイン・URL提示型/入力型のログイン・
// プラン制限（403）後の実行可否の再取得、秘密情報（パスワード）が画面に残らないことを検証する。

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getV1Connection: vi.fn(),
  putV1Connection: vi.fn(),
  getV1ConnectionLocations: vi.fn(),
  getV1ConnectionAvailableLocations: vi.fn(),
  putV1ConnectionLocationsLocationIdFavorite: vi.fn(),
  deleteV1ConnectionLocationsLocationIdFavorite: vi.fn(),
  getV1ConnectionGateway: vi.fn(),
  getV1ConnectionCapabilities: vi.fn(),
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

const ok = { available: true };
const capabilitiesOf = (overrides: Record<string, unknown> = {}) => ({
  status: 200,
  data: {
    capabilities: {
      login: ok, logout: ok, connectToLocation: ok, connectAuto: ok, changeLocation: ok, disconnect: ok,
      locationList: ok, locationFavorites: ok, pingMeasurement: ok, ...overrides,
    },
  },
});
const FREE_MESSAGE = "無料プランでは接続先を選べません。最速の無料サーバへ自動接続します。";
const freePlanCapabilities = capabilitiesOf({
  connectToLocation: { available: false, reason: "planRestricted", message: FREE_MESSAGE },
  locationList: { available: false, reason: "planRestricted", message: FREE_MESSAGE },
  locationFavorites: { available: false, reason: "planRestricted", message: FREE_MESSAGE },
  changeLocation: { available: false, reason: "planRestricted", message: FREE_MESSAGE },
  pingMeasurement: { available: false, reason: "unsupported", message: "このVPNプロバイダでは利用できません" },
});
const notLoggedInCapabilities = capabilitiesOf({
  connectToLocation: { available: false, reason: "notLoggedIn", message: "ログインしてください" },
  connectAuto: { available: false, reason: "notLoggedIn", message: "ログインしてください" },
  locationList: { available: false, reason: "notLoggedIn", message: "ログインしてください" },
  locationFavorites: { available: false, reason: "notLoggedIn", message: "ログインしてください" },
  changeLocation: { available: false, reason: "notLoggedIn", message: "ログインしてください" },
  logout: { available: false, reason: "notLoggedIn", message: "ログインしてください" },
});
const LOCATIONS = [
  { id: "jp-japan", country: "jp", countryName: "Japan", favorite: false, lastConnected: false },
  { id: "us-united-states", country: "us", countryName: "United States", favorite: false, lastConnected: false },
];

function renderApp() {
  return render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
}

describe("App（プロバイダの機能差・プラン制限）", () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getV1Connection.mockResolvedValue({ status: 200, data: { status: "disconnected" } });
    api.getV1ConnectionGateway.mockResolvedValue({
      status: 200,
      data: {
        transparentGateway: { state: "stopped", killSwitchBlocking: false },
        explicitProxy: { state: "stopped", restartCount: 0 },
      },
    });
    api.getV1ConnectionLocations.mockResolvedValue({ status: 200, data: LOCATIONS });
    api.getV1ConnectionCapabilities.mockResolvedValue(capabilitiesOf());
    api.getV1Session.mockResolvedValue({ status: 200, data: { loginMethod: "deviceUrl" } });
    api.getV1ConnectionAvailableLocations.mockResolvedValue({ status: 200, data: { locations: [] } });
  });

  describe("無料プラン（接続先を選べない・自動接続のみ）", () => {
    beforeEach(() => {
      api.getV1ConnectionCapabilities.mockResolvedValue(freePlanCapabilities);
      api.getV1Session.mockResolvedValue({
        status: 200,
        data: { loginMethod: "credentials", loggedIn: true, plan: { id: "free", label: "Free" } },
      });
    });

    it("接続先リストは出さず理由の枠を表示し、接続先の一覧を取得しない。プラン名を表示する", async () => {
      renderApp();
      expect(await screen.findByText(FREE_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(screen.getByText(/ログイン済み（プラン: Free）/)).toBeInTheDocument();
      expect(api.getV1ConnectionLocations).not.toHaveBeenCalled();
    });

    it("接続できる国の参考一覧を、選択できない要素として理由の下に表示する", async () => {
      api.getV1ConnectionAvailableLocations.mockResolvedValue({
        status: 200,
        data: {
          locations: [
            { code: "US", name: "アメリカ合衆国", cities: ["Ashburn", "Chicago"] },
            { code: "JP", name: "日本", cities: [] },
          ],
        },
      });
      renderApp();
      const group = await screen.findByRole("group", { name: "接続できる国（参考）" });
      expect(group).toHaveTextContent("選択はできません");
      expect(group).toHaveTextContent("アメリカ合衆国（Ashburn、Chicago）");
      expect(group).toHaveTextContent("日本");
      expect(group.querySelector("button, a, input")).toBeNull();
    });

    it("参考一覧が空、または取得に失敗しても、何も表示せず通知もしない", async () => {
      api.getV1ConnectionAvailableLocations.mockRejectedValue(new Error("boom"));
      renderApp();
      await screen.findByText(FREE_MESSAGE);
      await waitFor(() => expect(api.getV1ConnectionAvailableLocations).toHaveBeenCalled());
      expect(screen.queryByRole("group", { name: "接続できる国（参考）" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("［接続］は接続先を指定しない接続（locationIdなし）を要求する", async () => {
      api.putV1Connection.mockResolvedValueOnce({ status: 200, data: { status: "connected", location: "JP-FREE#5 in Tokyo, Japan" } });
      renderApp();
      await screen.findByText(FREE_MESSAGE);
      const button = await screen.findByRole("button", { name: "接続" });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);
      expect(api.putV1Connection).toHaveBeenCalledWith({ connect: true });
      expect(screen.queryByText("選択中の接続先", { exact: false })).not.toBeInTheDocument();
    });

    it("ログイン済みでログアウトが可能なため、ログインフォームは出さない", async () => {
      renderApp();
      await screen.findByText(FREE_MESSAGE);
      expect(screen.queryByLabelText("パスワード")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "ログアウト" })).toBeEnabled();
    });

    it("接続が403（プラン制限）で失敗したら、プラン制限として通知し、実行可否を再取得する", async () => {
      // 判定では有料と見えている（制限なし）が、実行すると制限に当たる状況。
      api.getV1ConnectionCapabilities.mockResolvedValue(capabilitiesOf());
      api.putV1Connection.mockResolvedValueOnce({
        status: 403,
        data: { error: "operation_restricted", message: "現在のプランでは利用できない操作です", exitCode: 2, stderr: "not available on the free plan" },
      });
      renderApp();
      const selectRadio = await screen.findByRole("radio", { name: /Japan/ });
      await userEvent.click(selectRadio);
      const callsBefore = api.getV1ConnectionCapabilities.mock.calls.length;
      api.getV1ConnectionCapabilities.mockResolvedValue(freePlanCapabilities);
      await userEvent.click(screen.getByRole("button", { name: "接続" }));

      expect(await screen.findByText(/現在のプランでは利用できない操作です/)).toBeInTheDocument();
      await waitFor(() => expect(api.getV1ConnectionCapabilities.mock.calls.length).toBeGreaterThan(callsBefore));
      // 再取得の結果が反映され、接続先リストが理由の枠に置き換わる。
      expect(await screen.findByText(FREE_MESSAGE)).toBeInTheDocument();
    });
  });

  describe("有料プラン（国単位の一覧・pingなし）", () => {
    it("接続先リストから選んで接続でき、ping列は出さず、再計測は理由付きで無効になる", async () => {
      api.getV1ConnectionCapabilities.mockResolvedValue(
        capabilitiesOf({ pingMeasurement: { available: false, reason: "unsupported", message: "このVPNプロバイダでは利用できません" } }),
      );
      api.putV1Connection.mockResolvedValueOnce({ status: 200, data: { status: "connected", country: "jp", location: "JP#1 in Tokyo, Japan", locationId: "jp-japan" } });
      renderApp();
      const radio = await screen.findByRole("radio", { name: /Japan/ });
      // 都市を持たない接続先は国名が主表示（補足の国名は重複しない）。ping列は無い。
      expect(radio.closest("li")).not.toHaveTextContent("ms");
      expect(screen.getByRole("button", { name: "再計測" })).toBeDisabled();
      expect(screen.getByText("このVPNプロバイダでは利用できません")).toBeInTheDocument();

      await userEvent.click(radio);
      await userEvent.click(screen.getByRole("button", { name: "接続" }));
      expect(api.putV1Connection).toHaveBeenCalledWith({ connect: true, locationId: "jp-japan" });
      // 接続先リストが使えるときは、参考一覧を取得も表示もしない。
      expect(api.getV1ConnectionAvailableLocations).not.toHaveBeenCalled();
    });
  });

  describe("未ログイン", () => {
    beforeEach(() => {
      api.getV1ConnectionCapabilities.mockResolvedValue(notLoggedInCapabilities);
      api.getV1Session.mockResolvedValue({ status: 200, data: { loginMethod: "credentials", loggedIn: false } });
    });

    it("［接続］は「ログインしてください」の理由付きで無効になり、ログインフォームが表示される", async () => {
      renderApp();
      const connect = await screen.findByRole("button", { name: "接続" });
      await waitFor(() => expect(connect).toBeDisabled());
      expect(connect).toHaveAccessibleDescription("ログインしてください");
      expect(screen.getByText(/アカウント:/)).toHaveTextContent("未ログイン");
      expect(screen.getByLabelText("パスワード")).toBeInTheDocument();
      expect(api.getV1ConnectionLocations).not.toHaveBeenCalled();
    });

    it("ログインフォームの送信: 資格情報をボディで送り、成功後は状態を再取得し、パスワード欄は空になる", async () => {
      api.postV1Session.mockResolvedValueOnce({ status: 200, data: { message: "ログインしました。" } });
      renderApp();
      await userEvent.type(await screen.findByLabelText("ユーザー名"), "user@proton.me");
      await userEvent.type(screen.getByLabelText("パスワード"), "hunter2-secret");
      await userEvent.type(screen.getByLabelText(/2段階認証コード/), "123456");
      const callsBefore = api.getV1Session.mock.calls.length;
      await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

      expect(api.postV1Session).toHaveBeenCalledWith({ username: "user@proton.me", password: "hunter2-secret", twoFactorCode: "123456" });
      expect(await screen.findByText("ログインしました。")).toBeInTheDocument();
      await waitFor(() => expect(api.getV1Session.mock.calls.length).toBeGreaterThan(callsBefore));
      expect(screen.getByLabelText("パスワード")).toHaveValue("");
      expect(screen.getByLabelText(/2段階認証コード/)).toHaveValue("");
      expect(document.body).not.toHaveTextContent("hunter2-secret");
    });

    it("ログイン失敗（422）でもパスワードは欄に残らず、トーストにも出ない。ユーザー名は残る", async () => {
      api.postV1Session.mockResolvedValueOnce({
        status: 422,
        data: { error: "command_failed", exitCode: 1, stderr: "Error: Authentication failed for password ***." },
      });
      renderApp();
      await userEvent.type(await screen.findByLabelText("ユーザー名"), "user@proton.me");
      await userEvent.type(screen.getByLabelText("パスワード"), "hunter2-secret");
      await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

      expect(await screen.findByText(/ログインに失敗しました/)).toBeInTheDocument();
      expect(screen.getByLabelText("パスワード")).toHaveValue("");
      expect(screen.getByLabelText("ユーザー名")).toHaveValue("user@proton.me");
      expect(document.body).not.toHaveTextContent("hunter2-secret");
    });

    it("ユーザー名・パスワードが空の間は送信できない", async () => {
      renderApp();
      expect(await screen.findByRole("button", { name: "ログイン" })).toBeDisabled();
    });
  });

  describe("URL提示型ログイン（従来どおり）", () => {
    it("account未対応で状態が不明な場合、従来の［VPNベンダーへログイン］が出てログインURLを表示する。フォームは出ない", async () => {
      api.postV1Session.mockResolvedValueOnce({
        status: 200,
        data: { loginUrl: "https://auth.adguard.io/device_code?user_code=ABCD", message: "表示されたURLをブラウザで開いてログインを完了してください。" },
      });
      renderApp();
      await userEvent.click(await screen.findByRole("button", { name: "VPNベンダーへログイン" }));
      // ボディなし（null）で呼ぶ。
      expect(api.postV1Session).toHaveBeenCalledWith(null);
      expect(await screen.findByRole("link", { name: "ログインURLを開く" })).toHaveAttribute(
        "href",
        "https://auth.adguard.io/device_code?user_code=ABCD",
      );
      expect(screen.queryByLabelText("パスワード")).not.toBeInTheDocument();
    });
  });

  describe("ログアウト", () => {
    it("確認のうえログアウトし、状態を再取得する。確認で拒否したら何もしない", async () => {
      api.getV1Session.mockResolvedValue({ status: 200, data: { loginMethod: "credentials", loggedIn: true, plan: { id: "paid", label: "Paid" } } });
      api.deleteV1Session.mockResolvedValue({ status: 200, data: { message: "You have been successfully signed out." } });
      const confirm = vi.spyOn(window, "confirm");
      renderApp();
      const button = await screen.findByRole("button", { name: "ログアウト" });

      confirm.mockReturnValueOnce(false);
      await userEvent.click(button);
      expect(api.deleteV1Session).not.toHaveBeenCalled();

      confirm.mockReturnValueOnce(true);
      await userEvent.click(button);
      await waitFor(() => expect(api.deleteV1Session).toHaveBeenCalledTimes(1));
      expect(await screen.findByText("ログアウトしました")).toBeInTheDocument();
      confirm.mockRestore();
    });
  });

  describe("実行可否を取得できない場合", () => {
    it("取得に失敗しても制限をかけず、従来どおり接続先リストから接続できる", async () => {
      api.getV1ConnectionCapabilities.mockRejectedValue(new Error("network down"));
      api.getV1Session.mockRejectedValue(new Error("network down"));
      renderApp();
      expect(await screen.findByRole("radio", { name: /Japan/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "VPNベンダーへログイン" })).toBeInTheDocument();
    });
  });
});
