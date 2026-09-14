import { describe, expect, it } from "vitest";
import { extractLoginUrl, parseConnectionOutput } from "./response-parser.js";

describe("parseConnectionOutput", () => {
  it("outputFormat=jsonの場合、status/countryを含むオブジェクトを返す", () => {
    expect(parseConnectionOutput("json", JSON.stringify({ status: "connected", country: "jp" }))).toEqual({
      status: "connected",
      country: "jp",
    });
  });

  it("outputFormat=jsonでcountryが無い場合、countryはundefinedになる", () => {
    expect(parseConnectionOutput("json", JSON.stringify({ status: "disconnected" }))).toEqual({
      status: "disconnected",
      country: undefined,
    });
  });

  it("outputFormat=jsonでstatusが不正な値の場合は例外を投げる", () => {
    expect(() => parseConnectionOutput("json", JSON.stringify({ status: "unknown" }))).toThrow();
  });

  it("outputFormat=textで'connected'を含む出力はconnectedと判定する", () => {
    expect(parseConnectionOutput("text", "Connected to TOKYO in TUN mode, running on tun0")).toEqual({
      status: "connected",
    });
  });

  it("outputFormat=textで'disconnected'を含む出力はconnectedの部分一致として誤検出しない", () => {
    expect(parseConnectionOutput("text", "VPN is disconnected")).toEqual({ status: "disconnected" });
  });

  it("outputFormat=textでいずれの語も含まない出力はdisconnectedとみなす", () => {
    expect(parseConnectionOutput("text", "some unrelated output")).toEqual({ status: "disconnected" });
  });

  it("未対応のoutputFormatの場合は例外を投げる", () => {
    expect(() => parseConnectionOutput("xml", "<status>connected</status>")).toThrow(/unsupported outputFormat/);
  });
});

describe("extractLoginUrl", () => {
  it("stdout中の最初のURLを抽出する", () => {
    expect(
      extractLoginUrl(
        "You need to authorize in your browser. The following link will be available for 1799 seconds: https://auth.adguard.io/device_code?user_code=NSXB-WJFL",
      ),
    ).toBe("https://auth.adguard.io/device_code?user_code=NSXB-WJFL");
  });

  it("URLが含まれない場合はundefinedを返す", () => {
    expect(extractLoginUrl("You are already logged in as user@example.com")).toBeUndefined();
  });

  it("ANSIエスケープシーケンスを含む出力からもURLを抽出する", () => {
    expect(extractLoginUrl("[1mhttps://auth.adguard.io/device_code?user_code=ABCD[0m")).toBe(
      "https://auth.adguard.io/device_code?user_code=ABCD",
    );
  });
});
