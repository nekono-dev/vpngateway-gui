// 責務: list-locations出力パーサー・ID／接続時指定名の導出の単体テスト。
// 入力は実機（AdGuard VPN CLI 1.7.12）の出力形式（ANSI付きヘッダ・固定幅の列）を再現している。

import { describe, expect, it } from "vitest";
import { parseLocationList } from "./location-list-parser.js";
import { toConnectName, toLocationId } from "./location-id.js";

const HEADER = "\x1B[1mISO   COUNTRY              CITY                           PING ESTIMATE\n\x1B[0m";
const row = (iso: string, country: string, city: string, ping: string) =>
  `${iso.padEnd(6)}${country.padEnd(21)}${city.padEnd(31)}${ping.padEnd(10)}\n`;
const FOOTER = "\nYou can connect to a location by running `adguardvpn-cli connect -l 'city, country or ISO code'`\n";

describe("parseLocationList", () => {
  it("空白を含む国名・都市名を桁位置で切り出し、IDと接続時指定名を導出する", () => {
    const out = HEADER + row("US", "United States", "Las Vegas", "111") + FOOTER;
    expect(parseLocationList(out)).toEqual([
      { id: "us-las-vegas", country: "us", countryName: "United States", city: "Las Vegas", connectName: "Las Vegas", pingMs: 111 },
    ]);
  });

  it("(Virtual)付きの都市は、表示名を保ちつつ接続時指定名から(Virtual)を除く", () => {
    const [shanghai] = parseLocationList(HEADER + row("CN", "China", "Shanghai (Virtual)", "59"));
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
    expect(parseLocationList(out).map((l) => l.id)).toEqual([
      "jp-tokyo",
      "kr-seoul",
      "us-dallas",
      "us-atlanta",
      "xx-unknown",
    ]);
    expect(parseLocationList(out).at(-1)?.pingMs).toBeUndefined();
  });

  it("非ASCIIの都市名を保持する", () => {
    const [sp] = parseLocationList(HEADER + row("BR", "Brazil", "São Paulo", "294"));
    expect(sp).toMatchObject({ id: "br-sao-paulo", city: "São Paulo", connectName: "São Paulo" });
  });

  it("データ行がなければ空配列を返す", () => {
    expect(parseLocationList(HEADER + FOOTER)).toEqual([]);
  });

  it("ヘッダ行が無い出力（想定外の書式）は例外にする", () => {
    expect(() => parseLocationList("You are not logged in\n")).toThrow(/header row not found/);
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
    expect(toConnectName("Mumbai (Virtual)")).toBe("Mumbai");
    expect(toConnectName("Tokyo")).toBe("Tokyo");
  });
});
