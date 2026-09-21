// 責務: CLIの接続先一覧（固定幅の表）を、接続先（ロケーション）の配列へ変換し、ping昇順に並べる。
// ベンダー非依存の整形層（profile/response-parser.ts）の兄弟にあたるが、接続状態ではなく接続先一覧を扱うため
// locations/に置く。列名（ヘッダ行）と接続時の指定名の出典はプロファイル（`listLocations`）から受け取り、
// どの表も同じ処理で読む（apiserver/design.md「接続先一覧の汎用化」）。

import { stripAnsi } from "../lib/strip-ansi.js";
import { toConnectName, toLocationId } from "./location-id.js";

// パース直後の接続先（お気に入り・前回接続の別はまだ付与しない）。
export interface ParsedLocation {
  id: string;
  // ISO国コード（小文字。例: "jp"）。
  country: string;
  countryName: string;
  // 一覧が表示する都市名。都市列を持たない表（国単位の一覧）では省略する。
  city?: string;
  // `%LOCATION%`へ代入する接続時の指定名（`connectName`に従い、都市名から`stripPattern`の部分を除いたもの、またはISO国コード）。
  connectName: string;
  // ping推定値（ミリ秒）。列が無い・数値として読めなかった場合はundefined。
  pingMs?: number;
}

// 出力表の列名。`iso`・`country`は必須、`city`・`ping`は省略可。
export interface LocationTableSpec {
  iso: string;
  country: string;
  city?: string;
  ping?: string;
}

export interface ParseLocationOptions {
  table: LocationTableSpec;
  // 接続時の指定名の出典（プロファイルの`listLocations.connectName`）。
  connectName: { from: "city" | "iso"; stripPattern?: string };
}

// ISO国コード列の値として受理する形（英字2文字）。区切り行（`---`）や案内文はここで弾かれる。
const ISO_CODE_PATTERN = /^[A-Za-z]{2}$/;

type ColumnKey = keyof LocationTableSpec;

interface Column {
  key: ColumnKey;
  start: number;
}

/**
 * 目的: 列名が単語として現れるヘッダ行かを判定する（"ISO"が"ISOLATED"等の一部に一致しないようにする）。
 * 入力: line(ヘッダ候補の行), names(全て含まれるべき列名)。
 * 出力: 全ての列名が単語として含まれればtrue。
 */
function isHeaderLine(line: string, names: string[]): boolean {
  return names.every((name) => new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(line));
}

/**
 * 目的: 接続先一覧の標準出力（表）を接続先の配列へ変換し、ping昇順に整列して返す。
 * 入力: stdout(exitCode=0の一覧コマンドの標準出力。ANSIエスケープを含んでよい),
 *       options(列名・接続時の指定名の出典。どちらも必須)。
 *       期待する形状: ヘッダ行に`options.table`の列名を全て含み、以降のデータ行が各列をヘッダと同じ桁位置から始める
 *       （国名・都市名は空白を含むため空白区切りでは分割できない）。
 * 出力: ping昇順（pingなしは末尾。同値は元の出力順）の接続先配列。データ行が0件なら空配列。
 * 失敗時の方針: ヘッダ行が見つからない場合は例外を投げる（CLIの書式変更を黙って空一覧にしないため）。
 *              ISO列が英字2文字でない行（空行・区切り行・案内文）、国名（・都市列があれば都市名）が空の行は読み飛ばす。
 * 例: parseLocationList("ISO   COUNTRY   CITY   PING ESTIMATE\nJP    Japan     Tokyo  4  ",
 *       { table: { iso: "ISO", country: "COUNTRY", city: "CITY", ping: "PING" }, connectName: { from: "city" } })
 *     // => [{ id: "jp-tokyo", country: "jp", countryName: "Japan", city: "Tokyo", connectName: "Tokyo", pingMs: 4 }]
 */
export function parseLocationList(stdout: string, options: ParseLocationOptions): ParsedLocation[] {
  const { table, connectName } = options;
  const lines = stripAnsi(stdout).split(/\r?\n/);

  const names = Object.values(table);
  const headerIndex = lines.findIndex((line) => isHeaderLine(line, names));
  if (headerIndex < 0) {
    throw new Error("unexpected location list output: header row not found");
  }
  const header = lines[headerIndex];

  // 各列の開始桁を、ヘッダ上の位置の昇順に並べる。データ行は次の列の開始桁までを当該列の値とする。
  const columns: Column[] = (Object.entries(table) as [ColumnKey, string][])
    .map(([key, name]) => ({ key, start: header.indexOf(name) }))
    .sort((a, b) => a.start - b.start);
  const cell = (line: string, key: ColumnKey): string | undefined => {
    const index = columns.findIndex((column) => column.key === key);
    if (index < 0) return undefined;
    return line.slice(columns[index].start, columns[index + 1]?.start).trim();
  };

  const parsed: ParsedLocation[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const isoCode = cell(line, "iso") ?? "";
    if (!ISO_CODE_PATTERN.test(isoCode)) continue;
    const countryName = cell(line, "country") ?? "";
    const city = cell(line, "city");
    // 国名が空、または都市列があるのに都市名が空の行は表の形をなしていないため読み飛ばす（IDを作れない）。
    if (countryName.length === 0 || (table.city !== undefined && (city ?? "").length === 0)) continue;
    const ping = Number.parseInt(cell(line, "ping") ?? "", 10);
    const cityName = table.city === undefined ? undefined : city;
    parsed.push({
      id: toLocationId(isoCode, cityName ?? countryName),
      country: isoCode.toLowerCase(),
      countryName,
      ...(cityName === undefined ? {} : { city: cityName }),
      connectName: connectName.from === "iso" || cityName === undefined ? isoCode : toConnectName(cityName, connectName.stripPattern),
      ...(Number.isNaN(ping) ? {} : { pingMs: ping }),
    });
  }
  return sortByPing(parsed);
}

/**
 * 目的: 接続先をping昇順に並べる（ping不明は末尾）。
 * 入力: locations(整列前の接続先配列。破壊しない)。
 * 出力: 新しい配列。同じping値同士は入力の順序を保つ（Array.prototype.sortは安定ソート）。
 */
function sortByPing(locations: ParsedLocation[]): ParsedLocation[] {
  return [...locations].sort((a, b) => {
    if (a.pingMs === undefined && b.pingMs === undefined) return 0;
    if (a.pingMs === undefined) return 1;
    if (b.pingMs === undefined) return -1;
    return a.pingMs - b.pingMs;
  });
}
