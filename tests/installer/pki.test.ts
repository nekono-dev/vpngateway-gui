// 責務: 通信路の保護に使う証明書一式の生成・配置の受け入れテスト。
// 受け入れ条件 installer/AC-8・AC-14 を、openssl による検証とファイル権限の確認で行う。

import { beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakeRepo, runSetupLib } from "../helpers/installer.js";

const pkiDir = join(mkdtempSync(join(tmpdir(), "vpngwgui-accept-pki-")), "pki");
let staging = "";

beforeAll(() => {
  const repo = makeFakeRepo();
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  // 証明書を生成し、配置先を一時ディレクトリへ差し替えて配置する。
  const script = [
    "ROLE_HOST_web=web.example; ROLE_HOST_api=api.example; ROLE_HOST_gateway=gw.example",
    "generate_role_pki >/dev/null",
    `PKI_DIR='${pkiDir}'; PKI_UID=${uid}; PKI_GID=${gid}`,
    "distribute_pki_local >/dev/null",
    'printf "%s" "$PKI_STAGING"',
  ].join("; ");
  const result = runSetupLib(repo, script);
  if (result.status !== 0) throw new Error(`pki generation failed: ${result.stderr}`);
  staging = result.stdout;
});

/** 目的: 認証局の証明書で、対象の証明書が検証できるかを openssl で確認する。 */
function verifies(caFile: string, certFile: string): boolean {
  return spawnSync("openssl", ["verify", "-CAfile", join(staging, caFile), join(staging, certFile)], { encoding: "utf8" }).status === 0;
}

describe("証明書一式", () => {
  it("installer/AC-8: 各サーバ証明書は対応する認証局で検証でき、生成物に認証局の秘密鍵が含まれない", () => {
    expect(verifies("gateway-ca.crt", "proxy-server.crt")).toBe(true);
    expect(verifies("gateway-ca.crt", "api-client.crt")).toBe(true);
    expect(verifies("api-ca.crt", "api-server.crt")).toBe(true);
    // Web の証明書は自己署名で、自分自身が信頼の起点になる。
    expect(verifies("web-server.crt", "web-server.crt")).toBe(true);
    // 相互TLSの認証局とWeb⇄APIの認証局は別で、取り違えると検証に失敗する。
    expect(verifies("api-ca.crt", "proxy-server.crt")).toBe(false);
    const names = readdirSync(staging).sort();
    expect(names).toEqual(
      [
        "api-ca.crt",
        "api-client.crt",
        "api-client.key",
        "api-server.crt",
        "api-server.key",
        "gateway-ca.crt",
        "proxy-server.crt",
        "proxy-server.key",
        "web-server.crt",
        "web-server.key",
      ].sort(),
    );
    expect(names).not.toContain("gateway-ca.key");
    expect(names).not.toContain("api-ca.key");
  });

  it("installer/AC-14: 配置後の証明書の置き場の権限は700、秘密鍵の権限は600であり、認証局の秘密鍵が存在しない", () => {
    expect(statSync(pkiDir).mode & 0o777).toBe(0o700);
    const files = readdirSync(pkiDir);
    for (const name of files.filter((file) => file.endsWith(".key"))) {
      expect(statSync(join(pkiDir, name)).mode & 0o777, name).toBe(0o600);
    }
    expect(files.filter((file) => /-ca\.key$/.test(file))).toEqual([]);
  });
});
