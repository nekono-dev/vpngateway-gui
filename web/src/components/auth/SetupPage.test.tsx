// 責務: 初期設定画面（SetupPage）のテスト。POST /v1/operatorをモックする。

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ postV1Operator: vi.fn() }));
vi.mock("../../generated/api/default/default", () => api);

const auth = vi.hoisted(() => ({ setAuthenticated: vi.fn() }));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => auth }));

const { SetupPage } = await import("./SetupPage");

async function fillAndSubmit(username: string, password: string, passwordConfirm = password) {
  await userEvent.type(screen.getByLabelText("ユーザー名"), username);
  await userEvent.type(screen.getByLabelText("パスワード（8文字以上）"), password);
  await userEvent.type(screen.getByLabelText("パスワード（確認）"), passwordConfirm);
  await userEvent.click(screen.getByRole("button", { name: "設定する" }));
}

describe("SetupPage", () => {
  beforeEach(() => {
    api.postV1Operator.mockReset();
    auth.setAuthenticated.mockReset();
  });

  it("パスワードが一致しなければAPIを呼ばずエラーを表示する", async () => {
    render(<SetupPage />);
    await fillAndSubmit("admin", "correct-password", "different-password");
    expect(screen.getByRole("alert")).toHaveTextContent("パスワードが一致しません");
    expect(api.postV1Operator).not.toHaveBeenCalled();
  });

  it("成功時はsetAuthenticatedを呼ぶ（POST /v1/operatorが併せてセッションを発行するため）", async () => {
    api.postV1Operator.mockResolvedValue({ status: 200, data: { configured: true, username: "admin" } });
    render(<SetupPage />);
    await fillAndSubmit("admin", "correct-password");
    expect(api.postV1Operator).toHaveBeenCalledWith({ username: "admin", password: "correct-password" });
    expect(auth.setAuthenticated).toHaveBeenCalledWith("admin");
  });

  it("409（作成済み）の場合はエラーメッセージを表示し、setAuthenticatedは呼ばない", async () => {
    api.postV1Operator.mockResolvedValue({ status: 409, data: { error: "already_configured" } });
    render(<SetupPage />);
    await fillAndSubmit("admin", "correct-password");
    expect(screen.getByRole("alert")).toHaveTextContent("既にアカウントが作成されています");
    expect(auth.setAuthenticated).not.toHaveBeenCalled();
  });
});
