// 責務: 実CLI（AdGuard VPN CLI）の`list-locations`が出力する固定幅の表を、接続先（ロケーション）の
// 配列へ変換し、ping昇順に並べる。ベンダー非依存の整形層（profile/response-parser.ts）の兄弟にあたるが、
// 接続状態ではなく接続先一覧を扱うためlocations/に置く。

import { stripAnsi } from "../lib/strip-ansi.js";
import { toConnectName, toLocationId } from "./location-id.js";

// パース直後の接続先（お気に入り・前回接続の別はまだ付与しない）。
export interface ParsedLocation {
  id: string;
  // ISO国コード（小文字。例: "jp"）。
  country: string;
  countryName: string;
  // `list-locations`が表示する都市名（例: "Shanghai (Virtual)"）。
  city: string;
  // `connect -l`へ渡す指定名（表示名から"(Virtual)"を除いたもの）。
  connectName: string;
  // ping推定値（ミリ秒）。数値として読めなかった場合はundefined。
  pingMs?: number;
}

// 行頭がISO国コード（英大文字2字＋空白）の行のみをデータ行として扱う。
const DATA_ROW_PATTERN = /^[A-Z]{2}\s/;

/**
 * 目的: `list-locations`の標準出力（表）を接続先の配列へ変換し、ping昇順に整列して返す。
 * 入力: stdout(exitCode=0の`list-locations`の標準出力。ANSIエスケープを含んでよい)。
 *       期待する形状: 1行目付近に`ISO`/`COUNTRY`/`CITY`/`PING`を含むヘッダ行があり、以降のデータ行が
 *       各列をヘッダと同じ桁位置から始める（国名・都市名は空白を含むため空白区切りでは分割できない）。
 * 出力: ping昇順（pingなしは末尾。同値は元の出力順）の接続先配列。データ行が0件なら空配列。
 * 失敗時の方針: ヘッダ行が見つからない場合は例外を投げる（CLIの書式変更を黙って空一覧にしないため）。
 *              データ行の形をなさない行（空行・末尾の案内文）は読み飛ばす。
 * 例: parseLocationList("ISO   COUNTRY   CITY   PING ESTIMATE\nJP    Japan     Tokyo  4  ")
 *     // => [{ id: "jp-tokyo", country: "jp", countryName: "Japan", city: "Tokyo", connectName: "Tokyo", pingMs: 4 }]
 */
export function parseLocationList(stdout: string): ParsedLocation[] {
  const lines = stripAnsi(stdout).split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\s*ISO\s+COUNTRY\s+CITY\s+PING/.test(line));
  if (headerIndex < 0) {
    throw new Error("unexpected list-locations output: header row not found");
  }
  const header = lines[headerIndex];
  const countryStart = header.indexOf("COUNTRY");
  const cityStart = header.indexOf("CITY");
  const pingStart = header.indexOf("PING");

  const parsed: ParsedLocation[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!DATA_ROW_PATTERN.test(line)) continue;
    const isoCode = line.slice(0, countryStart).trim();
    const countryName = line.slice(countryStart, cityStart).trim();
    const city = line.slice(cityStart, pingStart).trim();
    // 国名・都市名が空の行は表の形をなしていないため読み飛ばす（IDを作れない）。
    if (countryName.length === 0 || city.length === 0) continue;
    const ping = Number.parseInt(line.slice(pingStart).trim(), 10);
    parsed.push({
      id: toLocationId(isoCode, city),
      country: isoCode.toLowerCase(),
      countryName,
      city,
      connectName: toConnectName(city),
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
