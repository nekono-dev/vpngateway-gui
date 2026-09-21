// 責務: list-locations出力パーサー・ID／接続時指定名の導出の単体テスト。
// 入力は実機（AdGuard VPN CLI 1.7.12）の出力形式（ANSI付きヘッダ・固定幅の列）を再現している。

import { describe, expect, it } from "vitest";
import { parseLocationList } from "./location-list-parser.js";
import { toConnectName, toLocationId } from "./location-id.js";

const HEADER = "\x1B[1mISO   COUNTRY              CITY                           PING ESTIMATE\n\x1B[0m";
const row = (iso: string, country: string, city: string, ping: string) =>
  `${iso.padEnd(6)}${country.padEnd(21)}${city.padEnd(31)}${ping.padEnd(10)}\n`;
const FOOTER = "\nYou can connect to a location by running `adguardvpn-cli connect -l 'city, country or ISO code'`\n";

// 表の列名・接続時の指定名は、プロファイルが明示する（コードに既定を持たない）。この値は同梱のバンドルの宣言と同じ。
const TABLE_OPTIONS = {
  table: { iso: "ISO", country: "COUNTRY", city: "CITY", ping: "PING" },
  connectName: { from: "city" as const, stripPattern: "\\s*\\(Virtual\\)\\s*$" },
};

describe("parseLocationList", () => {
  it("空白を含む国名・都市名を桁位置で切り出し、IDと接続時指定名を導出する", () => {
    const out = HEADER + row("US", "United States", "Las Vegas", "111") + FOOTER;
    expect(parseLocationList(out, TABLE_OPTIONS)).toEqual([
      { id: "us-las-vegas", country: "us", countryName: "United States", city: "Las Vegas", connectName: "Las Vegas", pingMs: 111 },
    ]);
  });

  it("(Virtual)付きの都市は、表示名を保ちつつ接続時指定名から(Virtual)を除く", () => {
    const [shanghai] = parseLocationList(HEADER + row("CN", "China", "Shanghai (Virtual)", "59"), TABLE_OPTIONS);
    expect(shanghai).toMatchObject({ id: "cn-shanghai-virtual", city: "Shanghai (Virtual)", connectName: "Shanghai" });
  });

  it("ping昇順に整列し、同値は出力順を保ち、ping不明は末尾に置く", () => {
    const out =
      HEADER +
      row("US", "United States", "Dallas", "153") +
      row("JP", "Japan", "Tokyo", "4") +
      row("XX", "Nowhere", "Unknown", "N/A") +
      row("US", "United States", "Atlanta", "153") +
      row("KR", "South Korea", "Seoul", "25");
    expect(parseLocationList(out, TABLE_OPTIONS).map((l) => l.id)).toEqual([
      "jp-tokyo",
      "kr-seoul",
      "us-dallas",
      "us-atlanta",
      "xx-unknown",
    ]);
    expect(parseLocationList(out, TABLE_OPTIONS).at(-1)?.pingMs).toBeUndefined();
  });

  it("非ASCIIの都市名を保持する", () => {
    const [sp] = parseLocationList(HEADER + row("BR", "Brazil", "São Paulo", "294"), TABLE_OPTIONS);
    expect(sp).toMatchObject({ id: "br-sao-paulo", city: "São Paulo", connectName: "São Paulo" });
  });

  it("データ行がなければ空配列を返す", () => {
    expect(parseLocationList(HEADER + FOOTER, TABLE_OPTIONS)).toEqual([]);
  });

  it("ヘッダ行が無い出力（想定外の書式）は例外にする", () => {
    expect(() => parseLocationList("You are not logged in\n", TABLE_OPTIONS)).toThrow(/header row not found/);
  });
});

describe("toLocationId / toConnectName", () => {
  it("IDは国コード小文字＋都市slug", () => {
    expect(toLocationId("JP", "Tokyo")).toBe("jp-tokyo");
  });

  it("都市に英数字が無ければlocationにフォールバックする", () => {
    expect(toLocationId("JP", "東京")).toBe("jp-location");
  });

  it("末尾の(Virtual)のみを除く", () => {
    expect(toConnectName("Mumbai (Virtual)", "\\s*\\(Virtual\\)\\s*$")).toBe("Mumbai");
    expect(toConnectName("Tokyo", "\\s*\\(Virtual\\)\\s*$")).toBe("Tokyo");
  });

  it("stripPatternが無ければ加工しない", () => {
    expect(toConnectName("Mumbai (Virtual)")).toBe("Mumbai (Virtual)");
  });
});

describe("parseLocationList（Proton VPNの国一覧: 列名指定・都市列なし・区切り行）", () => {
  // 公式CLIは`tabulate`のsimple形式（ヘッダ・`---`の区切り行・左揃えの列）で出力する。
  // 先頭に「Server list is outdated, updating...」等の案内が付くことがある。
  const PROTON_OUTPUT = [
    "Server list is outdated, updating... This may take a moment.",
    "Country          Code",
    "---------------  ------",
    "Australia        AU",
    "United States    US",
    "Japan            JP",
    "",
  ].join("\n");
  const options = { table: { iso: "Code", country: "Country" }, connectName: { from: "iso" as const } };

  it("都市列が無い表では都市を持たない接続先になり、IDは国名のslug、接続時の指定名はISO国コードになる", () => {
    expect(parseLocationList(PROTON_OUTPUT, options)).toEqual([
      { id: "au-australia", country: "au", countryName: "Australia", connectName: "AU" },
      { id: "us-united-states", country: "us", countryName: "United States", connectName: "US" },
      { id: "jp-japan", country: "jp", countryName: "Japan", connectName: "JP" },
    ]);
  });

  it("列の並び（国名→コード）がAdGuard形式と逆でも、ヘッダの桁位置で読む", () => {
    const [first] = parseLocationList(PROTON_OUTPUT, options);
    expect(first.countryName).toBe("Australia");
    expect(first.country).toBe("au");
  });

  it("ヘッダ直下の区切り行・案内文はデータ行として扱わない", () => {
    const parsed = parseLocationList(PROTON_OUTPUT, options);
    expect(parsed).toHaveLength(3);
  });

  it("pingが無い表ではpingMsを持たず、出力順（CLIの並び）を保つ", () => {
    expect(parseLocationList(PROTON_OUTPUT, options).map((l) => l.id)).toEqual(["au-australia", "us-united-states", "jp-japan"]);
    expect(parseLocationList(PROTON_OUTPUT, options).every((l) => l.pingMs === undefined)).toBe(true);
  });

  it("指定した列名のヘッダが無い出力は例外（CLIの書式変更を黙って空一覧にしない）", () => {
    expect(() => parseLocationList("Country  Code\n---\nJapan  JP", { table: { iso: "ISO", country: "COUNTRY" }, connectName: { from: "city" } })).toThrow(
      "header row not found",
    );
  });
});
