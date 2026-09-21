// 責務: 接続先の絞り込み・現在の接続先／実効選択の決定（純粋関数）の単体テスト。

import { describe, expect, it } from "vitest";
import { filterLocations, type LocationItem } from "./location-filter";
import { findCurrentLocationId, resolveEffectiveId } from "./current-location";

const location = (id: string, country: string, countryName: string, city: string, favorite = false): LocationItem => ({
  id, country, countryName, city, favorite, lastConnected: false, pingMs: 1,
});
const LOCATIONS = [
  location("jp-tokyo", "jp", "Japan", "Tokyo", true),
  location("us-las-vegas", "us", "United States", "Las Vegas"),
  location("cn-shanghai-virtual", "cn", "China", "Shanghai (Virtual)", true),
];

describe("filterLocations", () => {
  it("検索語なしなら全件、favoritesタブならお気に入りのみ（順序を保つ）", () => {
    expect(filterLocations(LOCATIONS, "all", "").map((l) => l.id)).toEqual(["jp-tokyo", "us-las-vegas", "cn-shanghai-virtual"]);
    expect(filterLocations(LOCATIONS, "favorites", "").map((l) => l.id)).toEqual(["jp-tokyo", "cn-shanghai-virtual"]);
  });

  it("国コード・国名・都市名の部分一致で、大文字小文字を区別せず絞り込む", () => {
    expect(filterLocations(LOCATIONS, "all", "JAPAN").map((l) => l.id)).toEqual(["jp-tokyo"]);
    expect(filterLocations(LOCATIONS, "all", "vegas").map((l) => l.id)).toEqual(["us-las-vegas"]);
    expect(filterLocations(LOCATIONS, "all", "cn").map((l) => l.id)).toEqual(["cn-shanghai-virtual"]);
  });

  it("空白区切りの語はすべて満たす必要がある。タブと検索語は併用できる", () => {
    expect(filterLocations(LOCATIONS, "all", "us vegas").map((l) => l.id)).toEqual(["us-las-vegas"]);
    expect(filterLocations(LOCATIONS, "all", "us tokyo")).toEqual([]);
    expect(filterLocations(LOCATIONS, "favorites", "vegas")).toEqual([]);
  });
});

describe("findCurrentLocationId", () => {
  it("APIがlocationIdを返していればそれを使う", () => {
    expect(findCurrentLocationId({ status: "connected", locationId: "us-las-vegas" }, LOCATIONS)).toBe("us-las-vegas");
  });

  it("locationIdが無ければ、CLI報告の都市名と一覧のcityを大文字小文字無視で突き合わせる", () => {
    expect(findCurrentLocationId({ status: "connected", location: "TOKYO" }, LOCATIONS)).toBe("jp-tokyo");
    expect(findCurrentLocationId({ status: "connected", location: "SHANGHAI (Virtual)" }, LOCATIONS)).toBe("cn-shanghai-virtual");
  });

  it("切断中・未取得・特定できない場合はundefined", () => {
    expect(findCurrentLocationId({ status: "disconnected" }, LOCATIONS)).toBeUndefined();
    expect(findCurrentLocationId(undefined, LOCATIONS)).toBeUndefined();
    expect(findCurrentLocationId({ status: "connected", location: "BRUSSELS" }, LOCATIONS)).toBeUndefined();
    expect(findCurrentLocationId({ status: "connected" }, LOCATIONS)).toBeUndefined();
  });
});

describe("resolveEffectiveId", () => {
  it("明示的な選択が最優先", () => {
    expect(resolveEffectiveId("us-las-vegas", "jp-tokyo", "jp-tokyo", LOCATIONS)).toBe("us-las-vegas");
  });

  it("未選択なら、接続中は現在の接続先、切断中は最後に接続した接続先", () => {
    expect(resolveEffectiveId(undefined, "jp-tokyo", "us-las-vegas", LOCATIONS)).toBe("jp-tokyo");
    expect(resolveEffectiveId(undefined, undefined, "us-las-vegas", LOCATIONS)).toBe("us-las-vegas");
  });

  it("一覧に存在しないIDは採用しない（選択が古い場合は既定へ、既定も無ければundefined）", () => {
    expect(resolveEffectiveId("xx-gone", undefined, "jp-tokyo", LOCATIONS)).toBe("jp-tokyo");
    expect(resolveEffectiveId(undefined, undefined, "xx-gone", LOCATIONS)).toBeUndefined();
    expect(resolveEffectiveId(undefined, undefined, undefined, LOCATIONS)).toBeUndefined();
  });
});
