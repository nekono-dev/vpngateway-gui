// 責務: 認証状態による画面の出し分け（初期設定・ログイン・ダッシュボード）と、認証切れ時の復帰の受け入れテスト。
// 受け入れ条件 webserver/AC-3・AC-4 を、APIクライアントをモックした実際の画面（Root）で確認する。

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiMocks, installDashboardDefaults } from "./fixtures";

const api = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../../web/src/generated/api/default/default", async () => {
  const { createApiMocks: create } = await import("./fixtures");
  Object.assign(api, create(() => vi.fn()));
  return api;
});

const { Root } = await import("../../web/src/Root");
const { AuthProvider } = await import("../../web/src/contexts/AuthContext");
const { ToastProvider } = await import("../../web/src/notifications/ToastProvider");

const mocks = () => api as unknown as ReturnType<typeof createApiMocks>;

function renderRoot() {
  return render(
    <ToastProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  installDashboardDefaults(mocks());
});
afterEach(() => {
  vi.useRealTimers();
});

describe("認証による画面の出し分け", () => {
  it("webserver/AC-3: アカウント未作成なら初期設定画面、作成済みで未認証ならログイン画面、認証済みならダッシュボードを表示する", async () => {
    // 未作成: 初期設定画面だけが表示され、ダッシュボードの取得は始まらない。
    api.getV1Operator.mockResolvedValue({ status: 200, data: { configured: false } });
    const first = renderRoot();
    expect(await screen.findByRole("heading", { name: "初期設定" })).toBeInTheDocument();
    expect(api.getV1Connection).not.toHaveBeenCalled();
    first.unmount();

    // 作成済みで未認証（ユーザー名が含まれない）: ログイン画面だけが表示される。
    api.getV1Operator.mockResolvedValue({ status: 200, data: { configured: true } });
    const second = renderRoot();
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
    expect(api.getV1Connection).not.toHaveBeenCalled();
    second.unmount();

    // 認証済み: ダッシュボードが表示される。
    api.getV1Operator.mockResolvedValue({ status: 200, data: { configured: true, username: "admin" } });
    renderRoot();
    expect(await screen.findByRole("heading", { name: "VPNGateway-GUI" })).toBeInTheDocument();
    await waitFor(() => expect(api.getV1Connection).toHaveBeenCalled());
  });

  it("webserver/AC-4: ダッシュボードの操作が認証切れの応答を受けると、ログイン画面へ戻る", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderRoot();
    expect(await screen.findByRole("heading", { name: "VPNGateway-GUI" })).toBeInTheDocument();
    // セッションの定期確認（5秒ごと）が401を受けると、その場でログイン画面へ切り替わる。
    api.getV1OperatorSession.mockResolvedValue({ status: 401, data: { error: "unauthenticated" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "VPNGateway-GUI" })).not.toBeInTheDocument();
  });
});

describe("ログイン画面の失敗応答", () => {
  // 未認証の状態でログイン画面を表示し、資格情報を入力して送信する。
  async function submitLogin() {
    api.getV1Operator.mockResolvedValue({ status: 200, data: { configured: true } });
    renderRoot();
    await screen.findByRole("heading", { name: "ログイン" });
    await userEvent.type(screen.getByLabelText("ユーザー名"), "admin");
    await userEvent.type(screen.getByLabelText("パスワード"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));
  }

  it("webserver/AC-28: 502（Webサーバが上流のAPIへ到達できない）は成功扱いせず、APIサーバに接続できませんと表示する", async () => {
    api.postV1OperatorSession.mockResolvedValue({ status: 502, data: { error: "bad_gateway" } });
    await submitLogin();
    expect(await screen.findByRole("alert")).toHaveTextContent("ログインに失敗しました（APIサーバに接続できません）");
    expect(screen.queryByRole("heading", { name: "VPNGateway-GUI" })).not.toBeInTheDocument();
    expect(api.postV1OperatorSession).toHaveBeenCalledTimes(1);
  });

  it("webserver/AC-28: 500は成功扱いせず、要約を表示する", async () => {
    api.postV1OperatorSession.mockResolvedValue({ status: 500, data: {} });
    await submitLogin();
    expect(await screen.findByRole("alert")).toHaveTextContent("ログインに失敗しました");
    expect(screen.queryByRole("heading", { name: "VPNGateway-GUI" })).not.toBeInTheDocument();
  });

  it("webserver/AC-29: 通信例外は1回だけ再送し、再送で成功すればダッシュボードへ進む", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    api.postV1OperatorSession
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ status: 200, data: { authenticated: true } });
    await submitLogin();
    expect(await screen.findByRole("heading", { name: "VPNGateway-GUI" })).toBeInTheDocument();
    expect(api.postV1OperatorSession).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("webserver/AC-29: 通信例外が再送でも続くときだけ、APIサーバに接続できませんと表示する（再送は1回まで）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    api.postV1OperatorSession.mockRejectedValue(new TypeError("Failed to fetch"));
    await submitLogin();
    expect(await screen.findByRole("alert")).toHaveTextContent("ログインに失敗しました（APIサーバに接続できません）");
    expect(api.postV1OperatorSession).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("webserver/AC-30: 作成状態を取得できないとき（200以外）は初期設定画面を出さず、ログイン画面を表示する", async () => {
    api.getV1Operator.mockResolvedValue({ status: 502, data: { error: "bad_gateway" } });
    renderRoot();
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "初期設定" })).not.toBeInTheDocument();
  });

  it("webserver/AC-29: 401は再送しない（レート制限の計数を増やさない）", async () => {
    api.postV1OperatorSession.mockResolvedValue({ status: 401, data: { error: "unauthenticated" } });
    await submitLogin();
    expect(await screen.findByRole("alert")).toHaveTextContent("ユーザー名またはパスワードが正しくありません");
    expect(api.postV1OperatorSession).toHaveBeenCalledTimes(1);
  });
});
