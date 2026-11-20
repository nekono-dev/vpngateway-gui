// 責務: 詳細な接続先行のサーバ項目・距離・国行の ping 非表示を確かめる。

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocationDetailRow } from "./LocationDetailRow";

describe("LocationDetailRow", () => {
  it("サーバ行に名前・階層・負荷・Score を表示する", () => {
    render(<LocationDetailRow kind="server" name="JP-FREE#42" tier="free" load={18} score={7} />);

    expect(screen.getByText("JP-FREE#42")).toBeInTheDocument();
    expect(screen.getByText("無料")).toBeInTheDocument();
    expect(screen.getByText("18%")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("距離を formatDistance と同じ k km 形式で表示する", () => {
    render(<LocationDetailRow kind="location" name="London" country="gb" countryName="United Kingdom" distanceKm={9558.94} />);

    expect(screen.getByText("約 9.6k km")).toBeInTheDocument();
  });

  it("都市行に国名ヒントを表示しない", () => {
    const { container } = render(<LocationDetailRow kind="location" name="London" city="London" country="gb" countryName="United Kingdom" />);

    expect(container.querySelector(".hint")).toBeNull();
    expect(screen.queryByText("United Kingdom")).toBeNull();
  });

  it("距離がない行には距離を表示しない", () => {
    render(<LocationDetailRow kind="location" name="London" country="gb" countryName="United Kingdom" />);

    expect(screen.queryByText(/km/)).toBeNull();
  });

  it("国の行には ping 値を表示しない", () => {
    render(<LocationDetailRow kind="location" name="Japan" country="jp" countryName="Japan" pingMs={12} />);

    expect(screen.queryByText("12 ms")).toBeNull();
  });
});
