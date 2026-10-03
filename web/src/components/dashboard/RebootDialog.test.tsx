// 責務: ゲートウェイ再起動ダイアログ（RebootDialog）のテスト。POST /v1/gateway/rebootをモックする。

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ postV1GatewayReboot: vi.fn() }));
vi.mock("../../generated/api/default/default", () => api);

const { RebootDialog } = await import("./RebootDialog");

async function submit(password: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(/パスワード/), password);
  await userEvent.click(screen.getByRole("button", { name: "再起動" }));
}

describe("RebootDialog", () => {
  beforeEach(() => {
    api.postV1GatewayReboot.mockReset();
  });

  it("パスワードを送信し、受け付けられたら依頼した旨を表示する", async () => {
    api.postV1GatewayReboot.mockResolvedValue({ status: 202, data: { requested: true } });
    render(<RebootDialog open onClose={() => {}} />);
    await submit("correct-password");
    expect(api.postV1GatewayReboot).toHaveBeenCalledWith({ password: "correct-password" });
    expect(screen.getByRole("status")).toHaveTextContent("再起動を依頼しました");
  });

  it("401はパスワード誤りとしてダイアログ内に表示する", async () => {
    api.postV1GatewayReboot.mockResolvedValue({ status: 401, data: { error: "unauthenticated" } });
    render(<RebootDialog open onClose={() => {}} />);
    await submit("wrong");
    expect(screen.getByRole("alert")).toHaveTextContent("パスワードが正しくありません");
  });

  it("503は再起動の仕組みが未導入である旨を表示する", async () => {
    api.postV1GatewayReboot.mockResolvedValue({ status: 503, data: { error: "host_control_unavailable" } });
    render(<RebootDialog open onClose={() => {}} />);
    await submit("pw");
    expect(screen.getByRole("alert")).toHaveTextContent("導入されていません");
  });

  it("キャンセルで閉じ、APIを呼ばない", async () => {
    const onClose = vi.fn();
    render(<RebootDialog open onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onClose).toHaveBeenCalled();
    expect(api.postV1GatewayReboot).not.toHaveBeenCalled();
  });
});
