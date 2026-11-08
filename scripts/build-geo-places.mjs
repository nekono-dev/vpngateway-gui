// 責務: Natural Earth 5.1.2 の populated places（dbf）から、同梱用の座標データ（api/src/geo/places.json）を作る。
// 依存パッケージは使わず、dbf を標準機能だけで読む。入力の zip は次の SHA-256 と一致すること（検証済み）:
//   cd149186f03d2603e0410da399b980a4357d0ac32d3a2305a49ed3dffcc41d7b  ne_10m_populated_places.zip
// 使い方: node scripts/build-geo-places.mjs <ne_10m_populated_places.dbf> <出力先の JSON>
// 出力の形: { source, count, columns, rows }。rows の各行は columns の順（国の識別キー・名称・英語名・ASCII 名・人口・緯度・経度・首都の区分）。
// 首都の区分: 0 = Admin-0 capital、1 = Admin-0 region capital、null = それ以外（Admin-0 capital alt は含めない）。

import { readFileSync, writeFileSync, statSync } from "node:fs";

const EXPECTED_COUNT = 7342;
const [dbfPath, outPath] = process.argv.slice(2);
if (!dbfPath || !outPath) {
  console.error("使い方: node scripts/build-geo-places.mjs <dbf> <出力先>");
  process.exit(2);
}

const buf = readFileSync(dbfPath);
const recordCount = buf.readUInt32LE(4);
const headerLength = buf.readUInt16LE(8);
const recordLength = buf.readUInt16LE(10);

const fields = [];
let offset = 1;
for (let p = 32; buf[p] !== 0x0d; p += 32) {
  const name = buf.toString("ascii", p, p + 11).replace(/\0.*$/, "");
  const length = buf[p + 16];
  fields.push({ name, start: offset, length });
  offset += length;
}

const wanted = ["FEATURECLA", "NAME", "NAME_EN", "NAMEASCII", "ISO_A2", "ADM0_A3", "POP_MAX", "LATITUDE", "LONGITUDE"];
for (const name of wanted) {
  if (!fields.some((f) => f.name === name)) throw new Error(`dbf に項目 ${name} が無い`);
}
const fieldOf = (rec, name) => {
  const f = fields.find((x) => x.name === name);
  return rec.toString("utf8", f.start, f.start + f.length).trim();
};

const rows = [];
for (let i = 0; i < recordCount; i++) {
  const rec = buf.subarray(headerLength + i * recordLength, headerLength + (i + 1) * recordLength);
  if (rec[0] === 0x2a) continue; // 削除済みの記録
  const v = Object.fromEntries(wanted.map((k) => [k, fieldOf(rec, k)]));
  // 国の識別キー: ISO 3166-1 alpha-2。対応が無い記録（ISO_A2 が -99。コソボ等）は ADM0_A3 を使う。
  const key = v.ISO_A2 && v.ISO_A2 !== "-99" ? v.ISO_A2 : v.ADM0_A3;
  const capitalTier = v.FEATURECLA === "Admin-0 capital" ? 0 : v.FEATURECLA === "Admin-0 region capital" ? 1 : null;
  rows.push([key, v.NAME, v.NAME_EN, v.NAMEASCII, Number(v.POP_MAX) || 0, Number(v.LATITUDE), Number(v.LONGITUDE), capitalTier]);
}

if (rows.length !== EXPECTED_COUNT) {
  throw new Error(`件数が想定と違う: ${rows.length}（想定 ${EXPECTED_COUNT}）`);
}

const doc = {
  source: {
    dataset: "ne_10m_populated_places",
    version: "5.1.2",
    license: "public domain",
    zipSha256: "cd149186f03d2603e0410da399b980a4357d0ac32d3a2305a49ed3dffcc41d7b",
  },
  count: rows.length,
  columns: ["key", "name", "nameEn", "nameAscii", "population", "latitude", "longitude", "capitalTier"],
  rows,
};
writeFileSync(outPath, JSON.stringify(doc));
console.log(`records=${recordCount} written=${rows.length} bytes=${statSync(outPath).size}`);
