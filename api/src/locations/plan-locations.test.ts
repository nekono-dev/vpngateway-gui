// 責務: plan-locations（宣言に従ったサーバ一覧からの接続先抽出）の単体テスト。

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractPlanLocations, readPlanLocations, type AvailableLocationsDef } from "./plan-locations.js";

const def: AvailableLocationsDef = {
  file: "s.json",
  list: "Servers",
  country: "Country",
  city: "City",
  where: [
    { field: "Tier", equals: 0 },
    { field: "Status", equals: 1 },
  ],
  countryAliases: { UK: "GB" },
};
const server = (over: Record<string, unknown>) => ({ Country: "JP", Tier: 0, Status: 1, City: "Tokyo", ...over });

describe("extractPlanLocations", () => {
  it("条件を満たすサーバがある国だけを、都市を重複なく日本語の国名（五十音）順で返す", () => {
    const result = extractPlanLocations(
      {
        Servers: [
          server({}),
          server({ City: "Osaka" }),
          server({ City: "Tokyo" }),
          server({ Country: "US", City: "Ashburn" }),
          server({ Country: "DE", Tier: 2 }), // 条件外
          server({ Country: "FR", Status: 0 }), // 条件外
        ],
      },
      def,
    );
    expect(result).toEqual([
      { code: "US", name: "アメリカ合衆国", cities: ["Ashburn"] },
      { code: "JP", name: "日本", cities: ["Osaka", "Tokyo"] },
    ]);
  });

  it("countryAliasesは名称の解決にだけ使い、codeは元の値のまま。都市が無いサーバは都市なし", () => {
    expect(extractPlanLocations({ Servers: [server({ Country: "UK", City: null })] }, def)).toEqual([
      { code: "UK", name: "イギリス", cities: [] },
    ]);
  });

  it("whereが無ければ全サーバが対象。cityの宣言が無ければ都市は空", () => {
    const result = extractPlanLocations({ Servers: [server({ Tier: 2 })] }, { file: "s.json", list: "Servers", country: "Country" });
    expect(result).toEqual([{ code: "JP", name: "日本", cities: [] }]);
  });

  it("想定外の形式は空配列", () => {
    expect(extractPlanLocations(null, def)).toEqual([]);
    expect(extractPlanLocations({}, def)).toEqual([]);
    expect(extractPlanLocations({ Servers: "x" }, def)).toEqual([]);
  });
});

describe("readPlanLocations", () => {
  const dir = mkdtempSync(join(tmpdir(), "plan-loc-"));
  writeFileSync(join(dir, "s.json"), JSON.stringify({ Servers: [server({})] }));
  writeFileSync(join(dir, "broken.json"), "{");

  it("ファイルを読んで一覧を返す", () => {
    expect(readPlanLocations(def, dir)).toHaveLength(1);
  });

  it("ファイルが無い・壊れている・置き場の外を指す場合は空配列", () => {
    expect(readPlanLocations({ ...def, file: "none.json" }, dir)).toEqual([]);
    expect(readPlanLocations({ ...def, file: "broken.json" }, dir)).toEqual([]);
    expect(readPlanLocations({ ...def, file: "../etc/passwd" }, dir)).toEqual([]);
    expect(readPlanLocations({ ...def, file: "/etc/passwd" }, dir)).toEqual([]);
  });
});
