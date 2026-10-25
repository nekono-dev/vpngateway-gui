// 責務: 本番コードのベンダー中立性の検査（`scripts/check-vendor-neutrality.mjs`）の受け入れテスト。
// 受け入れ条件 runner/AC-13・AC-18 を、違反を含む一時ツリーと実リポジトリに対する実行で確認する。

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoPath, repoRoot } from "../helpers/repo.js";

/** 目的: 検査スクリプトを指定ルートに対して実行し、終了コードと出力を返す。 */
function runCheck(root: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [repoPath("scripts/check-vendor-neutrality.mjs"), root], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** 目的: 検査対象の最小構成の一時ツリー（ベンダーバンドル1つと本番コード1ファイル）を作る。 */
function makeTree(sourceText: string): string {
  const root = mkdtempSync(join(tmpdir(), "vpngwgui-accept-neutrality-"));
  mkdirSync(join(root, "vendors", "zzvendor"), { recursive: true });
  writeFileSync(
    join(root, "vendors", "zzvendor", "profile.json"),
    JSON.stringify({ vendor: "zzvendor", displayName: "ZZ Vendor", binary: "/usr/bin/zzvendor-cli", actions: {} }),
  );
  mkdirSync(join(root, "api", "src"), { recursive: true });
  writeFileSync(join(root, "api", "src", "app.ts"), sourceText);
  return root;
}

describe("ベンダー中立性の検査", () => {
  it("runner/AC-13: 本番コードにベンダー固有語を含むファイルがあると、検査が失敗する", () => {
    // コメントの中の語も検出する。
    const violating = runCheck(makeTree("// zzvendor-cli を呼ぶ\nconst x = 1;\n"));
    expect(violating.status).toBe(1);
    expect(violating.output).toContain("api/src/app.ts:1");
    // 固有語を含まないツリーは合格する。
    expect(runCheck(makeTree("const x = 1;\n")).status).toBe(0);
  });

  it("runner/AC-18: リポジトリの本番コードに対する検査の検出件数が0件である", () => {
    const { status, output } = runCheck(repoRoot);
    expect(output).not.toContain("件）");
    expect(status).toBe(0);
  });
});
