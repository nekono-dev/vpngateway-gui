// 責務: 受け入れテスト用の証明書（認証局・サーバ証明書・クライアント証明書）を openssl で一時ディレクトリへ生成する。
// 本番の証明書の生成は `installer/setup.sh` が行う。ここでは、通信路の検証（相互TLS）に必要な最小の一式だけを作る。

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 目的: openssl を実行し、失敗したら例外にする。 */
function openssl(args: string[]): void {
  const result = spawnSync("openssl", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`openssl ${args.join(" ")} failed: ${result.stderr}`);
}

export interface TestPki {
  dir: string;
  /** 認証局の証明書（PEMファイルのパス）。 */
  caCert: string;
  serverCert: string;
  serverKey: string;
  clientCert: string;
  clientKey: string;
}

/**
 * 目的: 認証局を作り、それが署名したサーバ証明書（SAN: 127.0.0.1）とクライアント証明書を生成する。
 * 入力: name(識別用の名前。証明書のCNに使う)。
 * 出力: 生成したファイルのパス一式。
 */
export function createTestPki(name: string): TestPki {
  const dir = mkdtempSync(join(tmpdir(), `vpngwgui-accept-pki-${name}-`));
  const file = (base: string) => join(dir, base);
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30", "-keyout", file("ca.key"), "-out", file("ca.crt"), "-subj", `/CN=${name}-ca`]);
  writeFileSync(file("server.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\n");
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", file("server.key"), "-out", file("server.csr"), "-subj", `/CN=${name}-server`]);
  openssl(["x509", "-req", "-in", file("server.csr"), "-CA", file("ca.crt"), "-CAkey", file("ca.key"), "-CAcreateserial", "-days", "30", "-out", file("server.crt"), "-extfile", file("server.ext")]);
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", file("client.key"), "-out", file("client.csr"), "-subj", `/CN=${name}-client`]);
  openssl(["x509", "-req", "-in", file("client.csr"), "-CA", file("ca.crt"), "-CAkey", file("ca.key"), "-CAcreateserial", "-days", "30", "-out", file("client.crt")]);
  return {
    dir,
    caCert: file("ca.crt"),
    serverCert: file("server.crt"),
    serverKey: file("server.key"),
    clientCert: file("client.crt"),
    clientKey: file("client.key"),
  };
}
