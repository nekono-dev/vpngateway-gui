// 責務: 頒布用スクリプトの生成（`installer/build-bootstrap.sh`）の受け入れテスト。
// 受け入れ条件 installer/AC-11 を、正常な生成と不正な指定の拒否で確認する。

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoPath } from "../helpers/repo.js";

const commit = "0123456789abcdef0123456789abcdef01234567";

/** 目的: 生成スクリプトを実行し、終了コード・標準出力・標準エラーを返す。 */
function build(ref: string, sha: string, url: string) {
  const result = spawnSync("sh", [repoPath("installer/build-bootstrap.sh"), ref, sha, url], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("頒布用スクリプトの生成", () => {
  it("installer/AC-11: 指定したコミットを埋め込み、不正な指定を拒否する", () => {
    const ok = build("refs/heads/main", commit, "https://example.test/repo.git");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain(`COMMIT='${commit}'`);
    expect(ok.stdout).toContain("REF='refs/heads/main'");
    expect(ok.stdout).toContain("REPO_URL='https://example.test/repo.git'");
    // 置換漏れの印が残らず、生成物のシェル構文が正しい。
    expect(ok.stdout).not.toMatch(/^[A-Z_]*='@@/m);
    const file = join(mkdtempSync(join(tmpdir(), "vpngwgui-accept-dist-")), "install.sh");
    writeFileSync(file, ok.stdout);
    expect(spawnSync("sh", ["-n", file]).status).toBe(0);
    // タグも受け付ける。
    expect(build("refs/tags/v1.0.0", commit, "file:///tmp/repo").status).toBe(0);
    // 不正な指定は、何も出力せず終了コード1になる。
    for (const bad of [
      build("main", commit, "https://example.test/repo.git"),
      build("refs/heads/main", "abc123", "https://example.test/repo.git"),
      build("refs/heads/main", commit.toUpperCase(), "https://example.test/repo.git"),
      build("refs/heads/main", commit, "ftp://example.test/repo.git"),
      build("refs/heads/ma;in", commit, "https://example.test/repo.git"),
    ]) {
      expect(bad.status).toBe(1);
      expect(bad.stdout).toBe("");
    }
  });
});
