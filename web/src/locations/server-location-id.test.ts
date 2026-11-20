import { describe, expect, it } from "vitest";
import { toServerLocationId } from "./server-location-id";

describe("toServerLocationId", () => {
  it("サーバ名を小文字にし、# を - に置き換えて srv- を付ける", () => {
    expect(toServerLocationId("US-IL#834")).toBe("srv-us-il-834");
  });
});
