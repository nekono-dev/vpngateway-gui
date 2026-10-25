// 責務: ベンダーへのログイン導線（資格情報入力型・URL提示型）と、秘密情報の取り扱いの受け入れテスト。
// 受け入れ条件 webserver/AC-9・AC-10・AC-23 を、APIクライアントをモックした実際の画面（App）で確認する。

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { capabilities, createApiMocks, installDashboardDefaults } from "./fixtures";

const api = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../../web/src/generated/api/default/default", async () => {
  const { createApiMocks: create } = await import("./fixtures");
  Object.assign(api, create(() => vi.fn()));
  return api;
});

const { App } = await import("../../web/src/App");
const { ToastProvider } = await import("../../web/src/notifications/ToastProvider");

const mocks = () => api as unknown as ReturnType<typeof createApiMocks>;
const notLoggedIn = capabilities({
  connectToLocation: { available: false, reason: "notLoggedIn", message: "ログインしてください" },
  locationList: { available: false, reason: "notLoggedIn", message: "ログインしてください" },
  locationFavorites: { available: false, reason: "notLoggedIn", message: "ログインしてください" },
  pingMeasurement: { available: false, reason: "notLoggedIn", message: "ログインしてください" },
});

const PASSWORD = "S3cret-P@ssw0rd!";
const TWO_FACTOR = "654321";

function renderApp() {
  return render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
}

beforeEach(() => {
  installDashboardDefaults(mocks());
  api.getV1ConnectionCapabilities.mockResolvedValue(notLoggedIn);
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/** 目的: 資格情報入力型のログインフォームを開き、ユーザー名・パスワード・2段階認証コードを入力して送信する。 */
async function submitCredentials(): Promise<void> {
  // ベンダーの一覧の取得後に接続操作の部品が再マウントされるため、取得が済んでから操作する。
  await screen.findByText("AdGuard VPN");
  await userEvent.click(await screen.findByRole("button", { name: "ログイン" }));
  await userEvent.type(screen.getByLabelText("ユーザー名"), "user@example.test");
  await userEvent.type(screen.getByLabelText("パスワード"), PASSWORD);
  await userEvent.click(screen.getByRole("button", { name: "2段階認証を設定している場合" }));
  await userEvent.type(screen.getByLabelText("2段階認証"), TWO_FACTOR);
  await userEvent.click(screen.getAllByRole("button", { name: "ログイン" }).at(-1) as HTMLElement);
}

describe("資格情報入力型のログイン", () => {
  beforeEach(() => {
    api.getV1Session.mockResolvedValue({ status: 200, data: { loginMethod: "credentials", loggedIn: false } });
  });

  it("webserver/AC-9: 資格情報入力型のログインは、送信の成否にかかわらず秘密情報の入力欄を空にする", async () => {
    // 失敗（422）: パスワードと2段階認証コードの欄は空になり、ユーザー名は残る。
    api.postV1Session.mockResolvedValueOnce({ status: 422, data: { error: "command_failed", exitCode: 1, stderr: "bad credentials" } });
    renderApp();
    await submitCredentials();
    await waitFor(() => expect(api.postV1Session).toHaveBeenCalledTimes(1));
    expect(api.postV1Session).toHaveBeenCalledWith({ username: "user@example.test", password: PASSWORD, twoFactorCode: TWO_FACTOR });
    await waitFor(() => expect(screen.getByLabelText("パスワード")).toHaveValue(""));
    expect(screen.getByLabelText("2段階認証")).toHaveValue("");
    expect(screen.getByLabelText("ユーザー名")).toHaveValue("user@example.test");

    // 成功: 送信の直後に欄が空になり、画面のどこにも秘密情報が表示されない。
    api.postV1Session.mockResolvedValueOnce({ status: 200, data: { message: "ログインしました。" } });
    await userEvent.type(screen.getByLabelText("パスワード"), PASSWORD);
    await userEvent.click(screen.getAllByRole("button", { name: "ログイン" }).at(-1) as HTMLElement);
    await waitFor(() => expect(api.postV1Session).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("パスワード")).toHaveValue(""));
    expect(document.body.textContent).not.toContain(PASSWORD);
    expect(document.body.textContent).not.toContain(TWO_FACTOR);
  });

  it("webserver/AC-23: ログインの送信後も、パスワードと2段階認証コードがブラウザの記憶領域に残らない", async () => {
    api.postV1Session.mockResolvedValue({ status: 200, data: { message: "ログインしました。" } });
    renderApp();
    await submitCredentials();
    await waitFor(() => expect(api.postV1Session).toHaveBeenCalled());
    const stored = [window.localStorage, window.sessionStorage].flatMap((storage) =>
      Array.from({ length: storage.length }, (_, index) => `${storage.key(index)}=${storage.getItem(storage.key(index) as string)}`),
    );
    expect(stored.join("\n")).not.toContain(PASSWORD);
    expect(stored.join("\n")).not.toContain(TWO_FACTOR);
    // 入力欄の自動入力の指定は、パスワードマネージャが扱える値である（保存はブラウザの管理に任せる）。
    expect(screen.getByLabelText("ユーザー名")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("パスワード")).toHaveAttribute("autocomplete", "current-password");
  });
});

describe("URL提示型のログイン", () => {
  it("webserver/AC-10: URL提示型のログインは、認証用のURLを表示する", async () => {
    api.getV1Session.mockResolvedValue({ status: 200, data: { loginMethod: "deviceUrl", loggedIn: false } });
    api.postV1Session.mockResolvedValue({
      status: 200,
      data: { loginUrl: "https://auth.example.test/device_code?user_code=ABCD-1234", message: "表示されたURLをブラウザで開いてログインを完了してください。" },
    });
    renderApp();
    await screen.findByText("AdGuard VPN");
    await userEvent.click(await screen.findByRole("button", { name: "VPNベンダーへログイン" }));
    const link = await screen.findByRole("link", { name: "ログインURLを開く" });
    expect(link).toHaveAttribute("href", "https://auth.example.test/device_code?user_code=ABCD-1234");
    // 本文なしで呼ばれる（資格情報は送らない）。
    expect(api.postV1Session).toHaveBeenCalledTimes(1);
    expect(api.postV1Session.mock.calls[0]?.[0]).toBeNull();
  });
});
