// 責務: ログイン状態・プラン表示（SessionCard）のコンポーネントテスト。
// プラン名への補足情報（usageNote）の併記（Phase 13。あり/なし）を検証する。

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionState } from "../../hooks/useDashboardPolling";
import { ToastProvider } from "../../notifications/ToastProvider";
import { SessionCard } from "./SessionCard";

vi.mock("../../generated/api/default/default", () => ({
  postV1Session: vi.fn(),
  deleteV1Session: vi.fn(),
}));

function renderSessionCard(session: SessionState | undefined) {
  return render(
    <ToastProvider>
      <SessionCard session={session} capabilities={undefined} onChanged={() => {}} />
    </ToastProvider>,
  );
}

describe("SessionCard プランの補足情報の併記（Phase 13）", () => {
  it("usageNoteがあれば、プラン名の直後に併記する", () => {
    renderSessionCard({
      loginMethod: "deviceUrl",
      loggedIn: true,
      plan: { id: "free", label: "Free", usageNote: "You have 3.00 GB left for this month" },
    });
    expect(screen.getByText(/プラン: Free・You have 3\.00 GB left for this month/)).toBeInTheDocument();
  });

  it("usageNoteが無ければ、プラン名のみを表示する（追加表示は出ない）", () => {
    renderSessionCard({
      loginMethod: "deviceUrl",
      loggedIn: true,
      plan: { id: "premium", label: "Premium" },
    });
    expect(screen.getByText(/プラン: Premium/)).toBeInTheDocument();
    expect(screen.queryByText(/・/)).not.toBeInTheDocument();
  });
});
