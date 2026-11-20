import { describe, expect, it } from "vitest";
import { LOCATION_ID_PATTERN, toServerLocationId } from "./location-id.js";

describe("location id", () => {
  it("サーバ名から小文字のサーバIDを作る", () => {
    expect(toServerLocationId("CH-US#13")).toBe("srv-ch-us-13");
  });

  it("都市IDとサーバIDを受け付ける", () => {
    const pattern = new RegExp(LOCATION_ID_PATTERN);
    expect(pattern.test("jp-tokyo")).toBe(true);
    expect(pattern.test("srv-ch-us-13")).toBe(true);
  });

  it("空、大文字を含むサーバID、上限を超えるIDを拒否する", () => {
    const pattern = new RegExp(LOCATION_ID_PATTERN);
    expect(pattern.test("")).toBe(false);
    expect(pattern.test("srv-CH-US-13")).toBe(false);
    expect(pattern.test(`jp-${"a".repeat(65)}`)).toBe(false);
    expect(pattern.test(`srv-${"a".repeat(64)}`)).toBe(false);
  });
});
