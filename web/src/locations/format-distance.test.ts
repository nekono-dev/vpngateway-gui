// 責務: 距離の表示文字列（千 km 単位・小数点以下第一位・「k km」）を確かめる。
import { describe, expect, it } from "vitest";
import { formatDistance } from "./format-distance";

describe("formatDistance", () => {
  it("千 km 単位の値を小数点以下第一位で表し、k km を付ける", () => {
    expect(formatDistance(2102.7)).toBe("2.1k km");
    expect(formatDistance(9558.9)).toBe("9.6k km");
    expect(formatDistance(0)).toBe("0.0k km");
  });
});
