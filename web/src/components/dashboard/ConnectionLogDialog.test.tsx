// 責務: 接続ログダイアログ（新しい順表示、操作名・接続先・結果の整形、空/エラー時表示）のコンポーネントテスト。

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getV1ConnectionLogMock } = vi.hoisted(() => ({ getV1ConnectionLogMock: vi.fn() }));
vi.mock("../../generated/api/default/default", () => ({ getV1ConnectionLog: getV1ConnectionLogMock }));

const { ConnectionLogDialog } = await import("./ConnectionLogDialog");

describe("ConnectionLogDialog", () => {
  beforeEach(() => {
    getV1ConnectionLogMock.mockReset();
  });

  it("操作履歴を新しい順に、操作名・接続国・結果つきで表示する", async () => {
    getV1ConnectionLogMock.mockResolvedValue({
      status: 200,
      data: [
        { timestamp: "2026-09-21T01:00:00.000Z", action: "connect", input: { connect: true, country: "jp" }, exitCode: 0 },
        { timestamp: "2026-09-21T02:00:00.000Z", action: "disconnect", input: { connect: false }, exitCode: 0 },
        { timestamp: "2026-09-21T03:00:00.000Z", action: "connect", input: { connect: true, country: "us" }, exitCode: 2 },
      ],
    });

    render(<ConnectionLogDialog open onClose={() => undefined} />);

    const rows = await screen.findAllByRole("row");
    // 先頭はヘッダ行。以降は新しい順（03:00 → 02:00 → 01:00）。
    expect(rows).toHaveLength(4);
    expect(within(rows[1]).getByText("接続")).toBeInTheDocument();
    expect(within(rows[1]).getByText("US")).toBeInTheDocument();
    expect(within(rows[1]).getByText("失敗 (exit 2)")).toHaveClass("log-ng");
    expect(within(rows[2]).getByText("切断")).toBeInTheDocument();
    expect(within(rows[3]).getByText("JP")).toBeInTheDocument();
    expect(within(rows[3]).getByText("成功")).toHaveClass("log-ok");
  });

  it("Phase 8以降の接続履歴（locationId）は国コードと都市で表示する", async () => {
    getV1ConnectionLogMock.mockResolvedValue({
      status: 200,
      data: [
        { timestamp: "2026-09-21T01:00:00.000Z", action: "connect", input: { connect: true, locationId: "us-las-vegas" }, exitCode: 0 },
        { timestamp: "2026-09-21T02:00:00.000Z", action: "connect", input: { connect: true, locationId: "jp-tokyo" }, exitCode: 0 },
      ],
    });
    render(<ConnectionLogDialog open onClose={() => undefined} />);
    expect(await screen.findByText("US / las vegas")).toBeInTheDocument();
    expect(screen.getByText("JP / tokyo")).toBeInTheDocument();
  });

  it("履歴が空なら空である旨を表示する", async () => {
    getV1ConnectionLogMock.mockResolvedValue({ status: 200, data: [] });
    render(<ConnectionLogDialog open onClose={() => undefined} />);
    expect(await screen.findByText("履歴はありません。")).toBeInTheDocument();
  });

  it("取得失敗（ステータス異常・通信失敗）はエラーを表示する", async () => {
    getV1ConnectionLogMock.mockResolvedValueOnce({ status: 500, data: {} });
    render(<ConnectionLogDialog open onClose={() => undefined} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("履歴の取得に失敗しました (status: 500)");

    getV1ConnectionLogMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await userEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByText(/APIサーバに接続できません/)).toBeInTheDocument();
  });

  it("閉じるボタンでonCloseを呼ぶ", async () => {
    getV1ConnectionLogMock.mockResolvedValue({ status: 200, data: [] });
    const onClose = vi.fn();
    render(<ConnectionLogDialog open onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("openがfalseの間はAPIを呼ばない", () => {
    render(<ConnectionLogDialog open={false} onClose={() => undefined} />);
    expect(getV1ConnectionLogMock).not.toHaveBeenCalled();
  });
});
