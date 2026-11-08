// 責務: 都市一覧コマンドの表から都市名を表順に取り出す。

export interface ParseCityListOptions {
  city: string;
}

/** 都市一覧の出力から、見出しに続く固定幅の表の都市列を読み取る。 */
export function parseCityList(stdout: string, options: ParseCityListOptions): string[] {
  const lines = stdout.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^\s*Cities in .+:\s*$/.test(line));
  if (headingIndex < 0) {
    throw new Error("unexpected city list output: Cities in <country>: heading not found");
  }

  const cityHeader = new RegExp(`(^|\\s)${escapeRegExp(options.city)}(?=\\s|$)`);
  const headerIndex = lines.findIndex(
    (line, index) => index > headingIndex && cityHeader.test(line) && /(^|\s)Features(?=\s|$)/.test(line),
  );
  if (headerIndex < 0) {
    throw new Error("unexpected city list output: Cities in <country>: table header not found");
  }

  const separator = lines[headerIndex + 1];
  if (!separator || !/^\s*-+\s{2,}-+\s*$/.test(separator)) {
    throw new Error("unexpected city list output: Cities in <country>: table separator not found");
  }

  const featuresStart = separator.search(/\s{2,}-/);
  if (featuresStart <= 0) {
    throw new Error("unexpected city list output: Cities in <country>: invalid table columns");
  }

  const cities = new Set<string>();
  for (const line of lines.slice(headerIndex + 2)) {
    if (line.trim() === "") break;
    const city = line.slice(0, featuresStart).trim();
    if (city !== "") cities.add(city);
  }
  return [...cities];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
