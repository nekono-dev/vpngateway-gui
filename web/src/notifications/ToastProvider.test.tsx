// 責務: トースト表示（要約の通常表示・詳細の折りたたみ・自動消去・手動クローズ）のコンポーネントテスト。

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./ToastProvider";

function Trigger() {
  const { notifyError, notifySuccess } = useToast();
  return (
    <>
      <button type="button" onClick={() => notifyError({ summary: "接続に失敗しました", detail: "stderr: boom" })}>
        error
      </button>
      <button type="button" onClick={() => notifySuccess("接続しました")}>
        success
      </button>
    </>
  );
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("エラーは要約をrole=alertで表示し、詳細は<details>の中に入れる", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText("error"));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("接続に失敗しました");
    const details = alert.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("stderr: boom");
  });

  it("エラーは自動では消えず、閉じるボタンで消える", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithProvider();
    await userEvent.click(screen.getByText("error"));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "通知を閉じる" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("成功通知はrole=statusで表示され、一定時間後に自動で消える", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithProvider();
    await userEvent.click(screen.getByText("success"));
    expect(screen.getByRole("status")).toHaveTextContent("接続しました");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("ToastProvider外でuseToastを呼ぶと例外", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
