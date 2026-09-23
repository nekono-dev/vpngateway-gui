// 責務: ログイン画面（LoginPage）のテスト。POST /v1/operator/sessionをモックする。

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ postV1OperatorSession: vi.fn() }));
vi.mock("../../generated/api/default/default", () => api);

const auth = vi.hoisted(() => ({ setAuthenticated: vi.fn() }));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => auth }));

const { LoginPage } = await import("./LoginPage");

async function fillAndSubmit(username: string, password: string) {
  await userEvent.type(screen.getByLabelText("ユーザー名"), username);
  await userEvent.type(screen.getByLabelText("パスワード"), password);
  await userEvent.click(screen.getByRole("button", { name: "ログイン" }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    api.postV1OperatorSession.mockReset();
    auth.setAuthenticated.mockReset();
  });

  it("成功時はsetAuthenticatedを呼ぶ", async () => {
    api.postV1OperatorSession.mockResolvedValue({ status: 200, data: { authenticated: true } });
    render(<LoginPage />);
    await fillAndSubmit("admin", "correct-password");
    expect(api.postV1OperatorSession).toHaveBeenCalledWith({ username: "admin", password: "correct-password" });
    expect(auth.setAuthenticated).toHaveBeenCalledWith("admin");
  });

  it("401の場合は「ユーザー名またはパスワードが正しくありません」を表示する", async () => {
    api.postV1OperatorSession.mockResolvedValue({ status: 401, data: { error: "unauthenticated" } });
    render(<LoginPage />);
    await fillAndSubmit("admin", "wrong-password");
    expect(screen.getByRole("alert")).toHaveTextContent("ユーザー名またはパスワードが正しくありません");
    expect(auth.setAuthenticated).not.toHaveBeenCalled();
  });

  it("429の場合はレート制限の文言を表示する", async () => {
    api.postV1OperatorSession.mockResolvedValue({ status: 429, data: { error: "too_many_requests" } });
    render(<LoginPage />);
    await fillAndSubmit("admin", "wrong-password");
    expect(screen.getByRole("alert")).toHaveTextContent("試行回数が多すぎます");
  });

  it("送信後、パスワード欄は成否にかかわらず空になる", async () => {
    api.postV1OperatorSession.mockResolvedValue({ status: 401, data: { error: "unauthenticated" } });
    render(<LoginPage />);
    await fillAndSubmit("admin", "wrong-password");
    expect(screen.getByLabelText("パスワード")).toHaveValue("");
  });
});
