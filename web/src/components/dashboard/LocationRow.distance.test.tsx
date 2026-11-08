// 責務: 接続先の行の距離の表示（距離が決まった行だけ「約 N km」・小数点以下第一位）を確かめる。

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocationRow } from "./LocationRow";
import type { LocationItem } from "../../locations/location-filter";

const base: LocationItem = { id: "gb-london", country: "gb", countryName: "United Kingdom", city: "London", favorite: false, lastConnected: false };

function renderRow(location: LocationItem, showPing = false) {
  return render(
    <LocationRow location={location} selected={false} current={false} disabled={false} showPing={showPing} onSelect={() => {}} onToggleFavorite={() => {}} />,
  );
}

describe("LocationRow の距離", () => {
  it("距離が決まった行は「約 N km」を小数点以下第一位で表示する", () => {
    renderRow({ ...base, distanceKm: 9558.94 });
    expect(screen.getByText("約 9558.9 km")).toBeInTheDocument();
  });

  it("距離が決まらない行は距離を表示しない", () => {
    renderRow(base);
    expect(screen.queryByText(/km/)).toBeNull();
  });

  it("距離の 0 も表示する（同じ国の行）", () => {
    renderRow({ ...base, distanceKm: 0 });
    expect(screen.getByText("約 0.0 km")).toBeInTheDocument();
  });
});
