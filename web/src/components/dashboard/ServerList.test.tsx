import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ServerList } from "./ServerList";
import type { GetV1ConnectionLocationsCityIdServers200Item } from "../../generated/api/endpoints.schemas";

const SERVERS: GetV1ConnectionLocationsCityIdServers200Item[] = [
  { name: "JP-TK#2", tier: "paid", load: 31, score: 2, favorite: true, connected: false },
  { name: "JP-TK#1", tier: "free", load: 8, score: 7, favorite: false, connected: true },
];

function renderServers() {
  const props = { servers: SERVERS, disabled: false, onSelect: vi.fn(), onToggleFavorite: vi.fn() };
  render(<ServerList {...props} />);
  return props;
}

describe("ServerList", () => {
  it("Score昇順でサーバ名・階層・負荷%・Scoreを表示する", () => {
    renderServers();
    const rows = screen.getAllByRole("radio").map((radio) => radio.closest("li")!);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/JP-TK#2.*有料.*31%.*2/),
      expect.stringMatching(/JP-TK#1.*無料.*8%.*7/),
    ]);
  });

  it("検索窓・件数の行・Scoreの説明を表示しない", () => {
    const { container } = render(<ServerList servers={SERVERS} disabled={false} onSelect={vi.fn()} onToggleFavorite={vi.fn()} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(container.querySelector("input[type=search]")).toBeNull();
    expect(screen.queryByText(/サーバ.*台/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Score.*意味|Score.*説明/i)).not.toBeInTheDocument();
  });

  it("☆は行選択と分離され、お気に入りの登録・解除を要求する", async () => {
    const { onToggleFavorite, onSelect } = renderServers();
    await userEvent.click(screen.getByRole("button", { name: "JP-TK#1をお気に入りに追加" }));
    expect(onToggleFavorite).toHaveBeenCalledWith("JP-TK#1", true);
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "JP-TK#2のお気に入りを解除" }));
    expect(onToggleFavorite).toHaveBeenCalledWith("JP-TK#2", false);
  });

  it("行の選択で、サーバの接続先ID（srv-…）を通知する", async () => {
    const { onSelect } = renderServers();
    await userEvent.click(screen.getByRole("radio", { name: /JP-TK#2/ }));
    expect(onSelect).toHaveBeenCalledWith("srv-jp-tk-2");
  });
});
