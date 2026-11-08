// 責務: ProtonVPNの実際の都市一覧出力を検証する。
import { describe, expect, it } from "vitest";
import { parseCityList } from "./city-list-parser.js";

const japanOutput = [
  "",
  "Cities in Japan:",
  "City    Features",
  "------  ----------",
  "Osaka   P2P",
  "Tokyo   P2P",
  "",
].join("\n");

const cambodiaOutput = [
  "",
  "Cities in Cambodia:",
  "City        Features",
  "----------  ----------",
  "Phnom Penh  P2P",
  "",
].join("\n");

const unitedStatesOutput = [
  "",
  "Cities in United States:",
  "City            Features",
  "--------------  ----------",
  "Ashburn         P2P",
  "Atlanta         P2P, Tor",
  "Boston          P2P",
  "Buffalo         P2P",
  "Charlotte       P2P",
  "Chicago         P2P",
  "Dallas          P2P",
  "Denver          P2P",
  "Houston         P2P",
  "Los Angeles     P2P",
  "Manassas        P2P",
  "Miami           P2P",
  "New York        P2P",
  "Phoenix         P2P",
  "Salt Lake City  P2P",
  "San Jose        P2P",
  "Seattle         P2P",
  "Washington      P2P",
  "",
].join("\n");

const invalidCountryOutput = [
  "Error: Invalid country code 'XX'. Please use a valid country code.",
  "",
  "Try 'protonvpn cities list --help' for more information.",
].join("\n");

describe("parseCityList", () => {
  it("JP実出力から表順に都市を取得する", () => {
    expect(parseCityList(japanOutput, { city: "City" })).toEqual(["Osaka", "Tokyo"]);
  });

  it("KH実出力から空白を含む都市名を取得する", () => {
    expect(parseCityList(cambodiaOutput, { city: "City" })).toEqual(["Phnom Penh"]);
  });

  it("US実出力から都市を順に取得し、Features内のカンマを都市と誤認しない", () => {
    expect(parseCityList(unitedStatesOutput, { city: "City" })).toEqual([
      "Ashburn", "Atlanta", "Boston", "Buffalo", "Charlotte", "Chicago", "Dallas", "Denver",
      "Houston", "Los Angeles", "Manassas", "Miami", "New York", "Phoenix", "Salt Lake City",
      "San Jose", "Seattle", "Washington",
    ]);
  });

  it("XX実出力のように見出しが無ければ例外にする", () => {
    expect(() => parseCityList(invalidCountryOutput, { city: "City" })).toThrow(/heading not found/);
  });

  it("表の後の案内文と空行を読み飛ばし、重複を除く", () => {
    const output = [
      "", "Cities in Cambodia:", "City        Features", "----------  ----------",
      "Phnom Penh  P2P", "Phnom Penh  P2P", "",
      "Tip: use --city to narrow the list.",
      "Injected    P2P",
    ].join("\n");
    expect(parseCityList(output, { city: "City" })).toEqual(["Phnom Penh"]);
  });

  it("見出しの前後に空行があっても解析する", () => {
    expect(parseCityList(`\n${japanOutput}\n`, { city: "City" })).toEqual(["Osaka", "Tokyo"]);
  });

  it("見出しがあってもヘッダーまたは区切り線が無ければ例外にする", () => {
    expect(() => parseCityList("Cities in Japan:\nOsaka", { city: "City" })).toThrow(/table header not found/);
    expect(() => parseCityList("Cities in Japan:\nCity    Features\nOsaka", { city: "City" })).toThrow(/separator not found/);
  });
});
