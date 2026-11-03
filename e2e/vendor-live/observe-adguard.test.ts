// 責務: 2.6 の観測で Seoul の接続先を選ぶ規則の単体テスト。実機には接続しない。

import { describe, expect, it } from "vitest";
import { pickSeoul } from "./observe-adguard";

describe("pickSeoul", () => {
  it("都市名が Seoul の接続先を選ぶ", () => {
    const locations = [
      { id: "jp-tokyo", country: "jp", countryName: "Japan", city: "Tokyo" },
      { id: "kr-seoul", country: "kr", countryName: "South Korea", city: "Seoul" },
    ];
    expect(pickSeoul(locations)?.id).toBe("kr-seoul");
  });

  it("都市名が無ければ ID の seoul、それも無ければ韓国の接続先を選ぶ", () => {
    expect(pickSeoul([{ id: "kr-seoul-1", country: "kr", countryName: "Korea" }])?.id).toBe("kr-seoul-1");
    expect(pickSeoul([{ id: "kr-busan", country: "kr", countryName: "Korea" }])?.id).toBe("kr-busan");
  });

  it("Seoul も韓国も無ければ undefined", () => {
    expect(pickSeoul([{ id: "jp-tokyo", country: "jp", countryName: "Japan" }])).toBeUndefined();
  });
});
