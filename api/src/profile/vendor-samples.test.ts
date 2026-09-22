// 責務: ベンダーバンドル（vendors/<ID>/）の適合テスト。全ベンダーのプロファイルを読み込み検証し、`samples.json`の実CLI出力サンプルを、
// ベンダーに依らない共通の処理（接続状態の判定・接続先一覧のパース・ログイン状態とプランの判定）へ流して期待値と照合する。
// ベンダーごとの出力の知識はバンドル（プロファイルと`samples.json`）に閉じ、このテストにも共通コードにも書かない
// （specs/design.md「ベンダー非依存の設計原則」）。バンドルを追加すると、このテストが自動でそのベンダーを対象にする。
//
// samples.jsonの形式: { description, cases: [ { name, kind: "status"|"listLocations"|"account", exitCode, stdout|output, expect } ] }
//   status: expect=ConnectionStatus / listLocations: expect=接続先の配列（各要素は期待するフィールドの部分一致）/
//   account: expect={ loggedIn, planId?, usageNote? }（planIdはプランの`id`、usageNoteは補足情報の抽出結果）。

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProfileFile } from "./profile-loader.js";
import { parseConnectionOutput } from "./response-parser.js";
import { parseLocationList } from "../locations/location-list-parser.js";
import { evaluateAccountOutput } from "../session/session-probe.js";
import { requireAction } from "./require-action.js";

interface SampleCase {
  name: string;
  kind: "status" | "listLocations" | "account";
  exitCode: number;
  stdout?: string;
  output?: string;
  expect: unknown;
}

const vendorsDir = join(import.meta.dirname, "../../../vendors");
const ids = readdirSync(vendorsDir).filter((id) => existsSync(join(vendorsDir, id, "profile.json")));

describe("ベンダーバンドルの適合テスト", () => {
  it("少なくとも1つのバンドルがあり、composeのfragmentを持つ", () => {
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(existsSync(join(vendorsDir, id, "compose.yml")), `${id}/compose.yml`).toBe(true);
    }
  });

  describe.each(ids)("%s", (id) => {
    const profile = parseProfileFile(join(vendorsDir, id, "profile.json"));
    const samplesPath = join(vendorsDir, id, "samples.json");
    const samples: { cases: SampleCase[] } | undefined = existsSync(samplesPath) ? JSON.parse(readFileSync(samplesPath, "utf8")) : undefined;

    it("プロファイルの`vendor`がディレクトリ名と一致し、samples.jsonを持つ", () => {
      expect(profile.vendor).toBe(id);
      expect(samples?.cases.length ?? 0).toBeGreaterThan(0);
    });

    it.each(samples?.cases ?? [])("$kind: $name", (sample) => {
      if (sample.kind === "status") {
        expect(parseConnectionOutput(profile.outputFormat, sample.stdout ?? "", profile.output)).toEqual(sample.expect);
      } else if (sample.kind === "listLocations") {
        const action = requireAction(profile, "listLocations");
        const parsed = parseLocationList(sample.stdout ?? "", { table: action.table, connectName: action.connectName });
        const expected = sample.expect as Record<string, unknown>[];
        expect(parsed).toHaveLength(expected.length);
        expected.forEach((item, index) => expect(parsed[index]).toMatchObject(item));
      } else {
        const info = evaluateAccountOutput(requireAction(profile, "account"), sample.exitCode, sample.output ?? "");
        const expected = sample.expect as { loggedIn: boolean; planId?: string; usageNote?: string };
        expect(info.loggedIn).toBe(expected.loggedIn);
        if (expected.planId !== undefined) expect(info.plan?.id).toBe(expected.planId);
        if (expected.usageNote !== undefined) expect(info.plan?.usageNote).toBe(expected.usageNote);
      }
    });
  });
});
