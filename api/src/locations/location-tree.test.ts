import { describe, expect, it } from "vitest";
import { buildCountryRows } from "./location-tree.js";

describe("buildCountryRows", () => {
  it("ProtonVPNの国表から国行を作り、ping値を出さない（ProtonVPN は locationPing が false なので計測不可）", () => {
    const rows = buildCountryRows({
      source: "countryTable",
      pingMeasurable: false,
      rows: [
        { country: "au", countryName: "Australia" },
        { country: "jp", countryName: "Japan" },
      ],
    });
    expect(rows).toEqual([
      { id: "au-australia", country: "au", countryName: "Australia", hasServerStage: true },
      { id: "jp-japan", country: "jp", countryName: "Japan", hasServerStage: true },
    ]);
    expect(rows.every((row) => !("pingMs" in row))).toBe(true);
  });

  it("AdGuardの都市行を国ごとに集約し、最小ping順に並べる", () => {
    const rows = buildCountryRows({
      source: "cityRows",
      pingMeasurable: true,
      rows: [
        { country: "us", countryName: "United States", city: "Dallas", pingMs: 35 },
        { country: "jp", countryName: "Japan", city: "Tokyo", pingMs: 12 },
        { country: "us", countryName: "United States", city: "Atlanta", pingMs: 8 },
        { country: "ca", countryName: "Canada", city: "Toronto" },
      ],
    });
    expect(rows).toEqual([
      { id: "us-united-states", country: "us", countryName: "United States", pingMs: 8, hasServerStage: false },
      { id: "jp-japan", country: "jp", countryName: "Japan", pingMs: 12, hasServerStage: false },
      { id: "ca-canada", country: "ca", countryName: "Canada", hasServerStage: false },
    ]);
    expect(rows.map(({ pingMs: _ping, ...row }) => row)).toEqual([
      { id: "us-united-states", country: "us", countryName: "United States", hasServerStage: false },
      { id: "jp-japan", country: "jp", countryName: "Japan", hasServerStage: false },
      { id: "ca-canada", country: "ca", countryName: "Canada", hasServerStage: false },
    ]);
  });

  it("ping計測不可ならソース順を保ち、国行のpingを持たない", () => {
    const rows = buildCountryRows({
      source: "cityRows",
      pingMeasurable: false,
      rows: [
        { country: "us", countryName: "United States", city: "Dallas", pingMs: 35 },
        { country: "jp", countryName: "Japan", city: "Tokyo", pingMs: 12 },
      ],
    });
    expect(rows.map((row) => row.country)).toEqual(["us", "jp"]);
    expect(rows.every((row) => !("pingMs" in row))).toBe(true);
  });
});
