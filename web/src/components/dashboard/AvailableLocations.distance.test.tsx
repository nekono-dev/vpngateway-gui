// 責務: 参考一覧の国の行の距離の表示（距離が決まった行だけ「約 N km」）を確かめる。

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvailableLocations } from "./AvailableLocations";

describe("AvailableLocations の距離", () => {
  it("距離が決まった国は「約 N km」を小数点以下第一位で表示する", () => {
    render(
      <AvailableLocations
        showPing={false}
        locations={[{ code: "gb", name: "英国", cities: ["London"], distanceKm: 9558.94 }]}
      />,
    );
    expect(screen.getByText("約 9.6k km")).toBeInTheDocument();
  });

  it("距離が決まらない国には距離を表示しない", () => {
    render(<AvailableLocations showPing={false} locations={[{ code: "pr", name: "プエルトリコ", cities: [] }]} />);
    expect(screen.queryByText(/km/)).toBeNull();
  });
});
