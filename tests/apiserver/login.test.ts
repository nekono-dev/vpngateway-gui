// 責務: ベンダーへのログイン（URL提示型・資格情報入力型）と、秘密情報の取り扱いの受け入れテスト。
// 受け入れ条件 apiserver/AC-8・AC-9・AC-26 を、ゲートウェイの代役が受け取った実行要求と監査ログで確認する。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createFakeCli } from "../helpers/fake-cli.js";
import { startApiHarness, type ApiHarness } from "../helpers/api-harness.js";

const cli = createFakeCli();
let harness: ApiHarness;

beforeAll(async () => {
  harness = await startApiHarness({ handlers: { exec: cli.exec } });
});
afterAll(async () => {
  await harness.stop();
});

const PASSWORD = "S3cret-P@ssw0rd!";
const TWO_FACTOR = "654321";

const post = (payload?: object) => harness.app.inject({ method: "POST", url: "/v1/session", payload });
async function switchTo(providerId: string): Promise<void> {
  await harness.app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId } });
}
/** 目的: 監査ログのファイルの全文を返す（まだ書かれていなければ空文字列）。 */
function auditLog(): string {
  try {
    return readFileSync(harness.auditLogFile, "utf8");
  } catch {
    return "";
  }
}

describe("ログイン", () => {
  it("apiserver/AC-8: 資格情報入力型のログインは、パスワードと2段階認証コードを標準入力にだけ渡す", async () => {
    await switchTo("protonvpn");
    cli.state.executed.length = 0;
    const response = await post({ username: "user@example.test", password: PASSWORD, twoFactorCode: TWO_FACTOR });
    expect(response.statusCode).toBe(200);
    const signin = cli.state.executed.find((entry) => (entry.body.resolvedArgv as string[])[0] === "signin");
    // 引数にはユーザー名だけが入り、秘密情報は入らない。
    expect(signin?.body.resolvedArgv).toEqual(["signin", "--totp", "user@example.test"]);
    expect(JSON.stringify(signin?.body.resolvedArgv)).not.toContain(PASSWORD);
    // 標準入力へは、プロファイルの順（パスワード、2段階認証コード）で1行ずつ渡る。
    expect(signin?.body.stdin).toBe(`${PASSWORD}\n${TWO_FACTOR}\n`);
    // 2段階認証コードを省略すると、その行は出力されない。
    cli.state.executed.length = 0;
    await post({ username: "user@example.test", password: PASSWORD });
    expect(cli.state.executed.find((entry) => (entry.body.resolvedArgv as string[])[0] === "signin")?.body.stdin).toBe(`${PASSWORD}\n`);
    // 改行を含むパスワードは、標準入力への余分な行の混入になるため400で拒否される。
    expect((await post({ username: "user@example.test", password: "a\nb" })).statusCode).toBe(400);
    // 本文が無いと400になる。
    expect((await post()).statusCode).toBe(400);
  });

  it("apiserver/AC-9: URL提示型のログインは、認証用のURLを応答で返す", async () => {
    await switchTo("adguardvpn");
    const response = await post();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ loginUrl: "https://auth.adguard.io/device_code?user_code=ABCD-1234" });
  });

  it("apiserver/AC-26: ログインを行った後の監査ログと、CLIが秘密情報を出力した失敗の応答に、秘密情報が含まれない", async () => {
    await switchTo("protonvpn");
    const username = "audit-user@example.test";
    expect((await post({ username, password: PASSWORD, twoFactorCode: TWO_FACTOR })).statusCode).toBe(200);
    // CLIが入力をそのまま出力に反映する失敗。応答の標準エラーでは、秘密情報が伏字になる。
    cli.state.failing.add("signin");
    const failed = await post({ username, password: PASSWORD, twoFactorCode: TWO_FACTOR });
    cli.state.failing.clear();
    expect(failed.statusCode).toBe(422);
    expect(failed.body).not.toContain(PASSWORD);
    expect(failed.body).not.toContain(TWO_FACTOR);
    expect(failed.body).toContain("rejected input");
    // 監査ログには、ユーザー名だけが残る。
    const log = auditLog();
    expect(log).toContain(username);
    expect(log).not.toContain(PASSWORD);
    expect(log).not.toContain(TWO_FACTOR);
  });
});
