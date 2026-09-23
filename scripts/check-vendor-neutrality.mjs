// 責務: 本番のソースコードにVPNベンダー固有の語（ID・名称・CLIのバイナリ名）が混入していないことを検査する
// （specs/requirements.md「ベンダー非依存性」、AGENTS.md「ベンダー非依存」）。1件でも見つかれば終了コード1で失敗する。
// 禁止語: `vendors/*/profile.json`の`vendor`・`displayName`・`binary`のファイル名から自動で作り、
//         `scripts/vendor-neutrality.words`（まだバンドルが無い既知のベンダー名）を加える。大文字小文字は区別しない。
// 検査対象: 本番のコード・スクリプト・composeの共通部・共通のDockerfile。**コメントも検査する**（コメントに固有名を残すと、
//         実装が変わったときに嘘になるため）。テスト（`*.test.*`）・生成物・依存物・仕様書・E2E・ベンダーバンドルは対象外。
// 使い方: node scripts/check-vendor-neutrality.mjs [検査対象のルート（既定: このスクリプトの親ディレクトリ）]

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? join(fileURLToPath(import.meta.url), "..", "..");

// 検査するディレクトリ（再帰）とファイル。
const TARGET_DIRS = ["api/src", "api/scripts", "proxy/src", "web/src", "web/server", "install", "compose"];
const TARGET_FILES = [
  "docker-compose.yml",
  "api/Dockerfile",
  "proxy/Dockerfile",
  "web/Dockerfile",
  "web/index.html",
  "web/vite.config.ts",
  "api/eslint.config.js",
];
// 検査しないディレクトリ名・ファイル名の型。
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "dist-server", "generated"]);
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/**
 * 目的: 禁止語を集める。
 * 入力: なし（`vendors/*\/profile.json`と`scripts/vendor-neutrality.words`を読む）。
 * 出力: 小文字の禁止語の配列（重複なし）。
 */
function collectForbiddenWords() {
  const words = new Set();
  const vendorsDir = join(root, "vendors");
  if (existsSync(vendorsDir)) {
    for (const id of readdirSync(vendorsDir)) {
      const profilePath = join(vendorsDir, id, "profile.json");
      if (!existsSync(profilePath)) continue;
      const profile = JSON.parse(readFileSync(profilePath, "utf8"));
      for (const value of [profile.vendor, profile.displayName, profile.binary ? basename(profile.binary) : undefined]) {
        if (typeof value === "string" && value.trim().length > 0) words.add(value.trim().toLowerCase());
      }
    }
  }
  const wordsFile = join(root, "scripts", "vendor-neutrality.words");
  if (existsSync(wordsFile)) {
    for (const line of readFileSync(wordsFile, "utf8").split("\n")) {
      const word = line.trim();
      if (word.length > 0 && !word.startsWith("#")) words.add(word.toLowerCase());
    }
  }
  return [...words];
}

/**
 * 目的: 検査対象のファイルの一覧を返す。
 * 出力: ファイルの絶対パスの配列（テスト・生成物・依存物を除く）。
 */
function collectTargetFiles() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (!SKIP_DIR_NAMES.has(name)) walk(path);
      } else if (!TEST_FILE.test(name)) {
        files.push(path);
      }
    }
  };
  for (const dir of TARGET_DIRS) {
    if (existsSync(join(root, dir))) walk(join(root, dir));
  }
  for (const file of TARGET_FILES) {
    if (existsSync(join(root, file))) files.push(join(root, file));
  }
  return files;
}

const forbidden = collectForbiddenWords();
const violations = [];
for (const file of collectTargetFiles()) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    // 1行につき1件（最初に見つかった語）だけ報告する。
    const word = forbidden.find((candidate) => lower.includes(candidate));
    if (word !== undefined) violations.push(`${relative(root, file)}:${index + 1}: "${word}" を含む: ${line.trim().slice(0, 100)}`);
  });
}

if (violations.length > 0) {
  console.error(`ベンダー固有の語が本番コードに含まれています（${violations.length}件）。プロファイル・ベンダーバンドルへ移すか、中立な表現にしてください。`);
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log(`ベンダー中立性の検査: OK（禁止語 ${forbidden.length} 語）`);
