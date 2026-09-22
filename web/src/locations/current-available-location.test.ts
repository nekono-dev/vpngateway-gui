// 責務: 参考一覧での現在の接続先の特定（findCurrentAvailableLocation）の単体テスト。

import { describe, expect, it } from "vitest";
import { findCurrentAvailableLocation } from "./current-available-location";
import type { AvailableLocation } from "../hooks/useAvailableLocations";

const LOCATIONS: AvailableLocation[] = [
  { code: "us", name: "アメリカ合衆国", cities: ["Seattle", "Chicago"] },
  { code: "jp", name: "日本", cities: ["Tokyo", "Osaka"] },
];

describe("findCurrentAvailableLocation", () => {
  it("未接続ならundefined", () => {
    expect(findCurrentAvailableLocation({ status: "disconnected" }, LOCATIONS)).toBeUndefined();
    expect(findCurrentAvailableLocation(undefined, LOCATIONS)).toBeUndefined();
  });

  it("都市名の完全一致で特定できる", () => {
    expect(findCurrentAvailableLocation({ status: "connected", location: "Tokyo" }, LOCATIONS)).toEqual({
      code: "jp",
      city: "Tokyo",
    });
  });

  // 実機確認（2026-09-22、Proton VPN無料プラン）: 自動接続時、CLIは都市名のみではなく
  // 「サーバ名 in 都市名, 国名」のような複合表記を報告する。
  it("CLIの複合表記（サーバ名 in 都市名, 国名）から都市名を部分一致で特定できる", () => {
    expect(
      findCurrentAvailableLocation({ status: "connected", location: "US-FREE#5 in Seattle, United States" }, LOCATIONS),
    ).toEqual({ code: "us", city: "Seattle" });
  });

  it("大文字小文字は区別しない", () => {
    expect(findCurrentAvailableLocation({ status: "connected", location: "seattle" }, LOCATIONS)).toEqual({
      code: "us",
      city: "Seattle",
    });
  });

  it("一致する都市が無い・都市名が無ければundefined", () => {
    expect(findCurrentAvailableLocation({ status: "connected", location: "Brussels" }, LOCATIONS)).toBeUndefined();
    expect(findCurrentAvailableLocation({ status: "connected" }, LOCATIONS)).toBeUndefined();
  });
});
