// 責務: TLS matrix 用証明書生成器の実出力を OpenSSL で検証する。

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const workDirs: string[] = [];

function makeWorkDir(): string {
  const path = mkdtempSync(join(tmpdir(), "vpngwgui-tls-certs-"));
  workDirs.push(path);
  return path;
}

function openssl(...args: string[]): string {
  return execFileSync("openssl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

afterEach(() => {
  for (const path of workDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("hosted TLS matrix 証明書", () => {
  it("Web と Gateway の証明書一式および失敗用 variant を作る", () => {
    const output = makeWorkDir();
    execFileSync("sh", ["e2e/hosted/lib/tls-matrix-certs.sh", output]);

    const checkPermissions = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        const mode = statSync(path).mode & 0o777;
        if (entry.isDirectory()) {
          expect(mode & 0o001, `${path} は UID 10001 が通過できる`).not.toBe(0);
          checkPermissions(path);
        } else if (entry.name.endsWith(".crt") || entry.name.endsWith(".key")) {
          expect(mode, `${path} は UID 10001 が読み取れる 0644`).toBe(0o644);
        }
      }
    };
    checkPermissions(output);

    expect(openssl("verify", "-CAfile", join(output, "web/ca.crt"), join(output, "web/server.crt"))).toContain(": OK");
    expect(openssl("verify", "-CAfile", join(output, "gateway/ca.crt"), join(output, "gateway/server.crt"))).toContain(": OK");
    expect(openssl("verify", "-CAfile", join(output, "gateway/ca.crt"), join(output, "gateway/api-client.crt"))).toContain(": OK");
    expect(openssl("x509", "-in", join(output, "web/server.crt"), "-noout", "-ext", "subjectAltName")).toContain("IP Address:127.0.0.1");
    expect(openssl("x509", "-in", join(output, "gateway/server.crt"), "-noout", "-ext", "subjectAltName")).toContain("DNS:gateway.local");

    const expiredDates = openssl("x509", "-in", join(output, "invalid/expired-server.crt"), "-noout", "-dates");
    expect(Date.parse(expiredDates.match(/notAfter=(.+)/)?.[1] ?? "")).toBeLessThan(Date.now());
    expect(openssl("verify", "-no_check_time", "-CAfile", join(output, "gateway/ca.crt"), join(output, "invalid/expired-server.crt"))).toContain(": OK");
    expect(openssl("x509", "-in", join(output, "invalid/wrong-ca-server.crt"), "-noout", "-ext", "subjectAltName")).toContain("DNS:gateway.local");
    expect(() => openssl("verify", "-CAfile", join(output, "gateway/ca.crt"), join(output, "invalid/wrong-ca-server.crt"))).toThrow();
    expect(openssl("verify", "-CAfile", join(output, "invalid/ca.crt"), join(output, "invalid/wrong-ca-server.crt"))).toContain(": OK");
    expect(openssl("x509", "-in", join(output, "invalid/san-mismatch.crt"), "-noout", "-ext", "subjectAltName")).not.toContain("DNS:gateway.local");
    expect(openssl("verify", "-CAfile", join(output, "gateway/ca.crt"), join(output, "invalid/san-mismatch.crt"))).toContain(": OK");
    expect(() => readFileSync(join(output, "invalid/missing-client.crt"))).toThrow();
  });
});
