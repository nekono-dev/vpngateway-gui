// 責務: 設定ダイアログのアカウント変更フォーム（AccountSettingsForm）のテスト。PUT /v1/operatorをモックする。

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ putV1Operator: vi.fn() }));
vi.mock("../../generated/api/default/default", () => api);

const { AccountSettingsForm } = await import("./AccountSettingsForm");

describe("AccountSettingsForm", () => {
  beforeEach(() => {
    api.putV1Operator.mockReset();
  });

  it("現在のパスワードのみで送信すると、変更項目が無い旨のエラーを表示しAPIを呼ばない", async () => {
    render(<AccountSettingsForm />);
    await userEvent.type(screen.getByLabelText("現在のパスワード"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "アカウントを変更" }));
    expect(screen.getByRole("alert")).toHaveTextContent("ユーザー名または新しいパスワードを入力してください");
    expect(api.putV1Operator).not.toHaveBeenCalled();
  });

  it("新しいパスワードを指定すると、currentPassword・newPasswordを送信し成功メッセージを表示する", async () => {
    api.putV1Operator.mockResolvedValue({ status: 200, data: { configured: true, username: "admin" } });
    render(<AccountSettingsForm />);
    await userEvent.type(screen.getByLabelText("現在のパスワード"), "correct-password");
    await userEvent.type(screen.getByLabelText(/新しいパスワード/), "new-password-1");
    await userEvent.click(screen.getByRole("button", { name: "アカウントを変更" }));
    expect(api.putV1Operator).toHaveBeenCalledWith({ currentPassword: "correct-password", newPassword: "new-password-1" });
    expect(screen.getByRole("status")).toHaveTextContent("変更しました");
  });

  it("401（現在のパスワード不一致）はダイアログ内にインライン表示する", async () => {
    api.putV1Operator.mockResolvedValue({ status: 401, data: { error: "unauthenticated" } });
    render(<AccountSettingsForm />);
    await userEvent.type(screen.getByLabelText("現在のパスワード"), "wrong-password");
    await userEvent.type(screen.getByLabelText(/新しいユーザー名/), "renamed");
    await userEvent.click(screen.getByRole("button", { name: "アカウントを変更" }));
    expect(screen.getByRole("alert")).toHaveTextContent("現在のパスワードが正しくありません");
  });
});
