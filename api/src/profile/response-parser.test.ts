import { describe, expect, it } from "vitest";
import { extractLoginUrl, parseConnectionOutput } from "./response-parser.js";

// テキスト出力の判定・書式は、プロファイルの`output`が宣言する（コードは既定の書式を持たない）。この値は同梱のバンドルの宣言と同じ。
const OUTPUT = {
  connectedPattern: "(?<![a-zA-Z])connected(?![a-zA-Z])",
  locationPattern: "(?<![a-zA-Z])Connected to (.+?)(?: in \\S+ mode|\\s*$)",
};

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
    expect(parseConnectionOutput("text", "Connected to TOKYO in TUN mode, running on tun0", OUTPUT)).toEqual({
      status: "connected",
      location: "TOKYO",
    });
  });

  it("接続先の都市名を抽出する（status形式・ANSI装飾・空白を含む都市名・connect形式）", () => {
    expect(
      parseConnectionOutput("text", "Connected to \x1B[1mBRUSSELS\x1B[0m in \x1B[1mTUN\x1B[0m mode, running on \x1B[1mtun0\x1B[0m\n", OUTPUT),
    ).toEqual({ status: "connected", location: "BRUSSELS" });
    expect(parseConnectionOutput("text", "Connected to NEW YORK in TUN mode, running on tun0", OUTPUT)).toEqual({
      status: "connected",
      location: "NEW YORK",
    });
    expect(
      parseConnectionOutput("text", "Log is being written to: /x/tunnel.log\nSuccessfully Connected to \x1B[1mTOKYO\x1B[0m\nYou are now connected.", OUTPUT),
    ).toEqual({ status: "connected", location: "TOKYO" });
  });

  it("都市名を読み取れない出力でも接続状態は判定する（locationなし）", () => {
    expect(parseConnectionOutput("text", "connected", OUTPUT)).toEqual({ status: "connected" });
  });

  it("outputFormat=textで'disconnected'を含む出力はconnectedの部分一致として誤検出しない", () => {
    expect(parseConnectionOutput("text", "VPN is disconnected", OUTPUT)).toEqual({ status: "disconnected" });
  });

  it("outputFormat=textでいずれの語も含まない出力はdisconnectedとみなす", () => {
    expect(parseConnectionOutput("text", "some unrelated output", OUTPUT)).toEqual({ status: "disconnected" });
  });

  it("text形式で正規表現が未指定なら例外（コードに既定の書式を持たない）", () => {
    expect(() => parseConnectionOutput("text", "connected")).toThrow(/requires output/);
    expect(() => parseConnectionOutput("text", "connected", { connectedPattern: "connected" })).toThrow(/requires output/);
  });

  it("locationPatternは第1キャプチャを接続先とし、一致しなければ接続先は不明（別の書式）", () => {
    const other = { connectedPattern: "^Status: Connected", locationPattern: "^Server: (.+?) in " };
    expect(parseConnectionOutput("text", "Status: Connected\nServer: node-1 in Paris", other)).toEqual({ status: "connected", location: "node-1" });
    expect(parseConnectionOutput("text", "Status: Connected\nnothing", other)).toEqual({ status: "connected" });
    expect(parseConnectionOutput("text", "Status: Disconnected", other)).toEqual({ status: "disconnected" });
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
