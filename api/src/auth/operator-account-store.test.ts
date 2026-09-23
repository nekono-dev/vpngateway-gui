// 責務: 単一管理者アカウントの永続化（作成・検証・更新）の単体テスト。

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), "vpngwgui-operator-"));

const {
  createOperatorAccount,
  getOperatorAccount,
  isOperatorConfigured,
  updateOperatorAccount,
  verifyOperatorPassword,
} = await import("./operator-account-store.js");
const { OperatorAlreadyConfiguredError } = await import("../errors.js");

describe("operator-account-store", () => {
  it("未作成の状態ではisOperatorConfigured=false・getOperatorAccount=null", () => {
    expect(isOperatorConfigured()).toBe(false);
    expect(getOperatorAccount()).toBeNull();
  });

  it("作成すると、平文パスワードはファイルへ残らずscryptハッシュとして保存される", () => {
    createOperatorAccount("admin", "correct-password");
    expect(isOperatorConfigured()).toBe(true);
    const account = getOperatorAccount();
    expect(account?.username).toBe("admin");
    expect(account?.algorithm).toBe("scrypt");
    expect(account?.hash).not.toBe("correct-password");
  });

  it("作成済みの状態で再度createOperatorAccountを呼ぶとOperatorAlreadyConfiguredError", () => {
    expect(() => createOperatorAccount("other", "other-password")).toThrow(OperatorAlreadyConfiguredError);
  });

  it("正しいユーザー名・パスワードのみverifyOperatorPassword=true", () => {
    expect(verifyOperatorPassword("admin", "correct-password")).toBe(true);
    expect(verifyOperatorPassword("admin", "wrong-password")).toBe(false);
    expect(verifyOperatorPassword("someone-else", "correct-password")).toBe(false);
  });

  it("updateOperatorAccountでユーザー名・パスワードを変更でき、新しい値でverifyできる", () => {
    updateOperatorAccount({ username: "renamed", newPassword: "new-password" });
    expect(verifyOperatorPassword("renamed", "new-password")).toBe(true);
    expect(verifyOperatorPassword("admin", "correct-password")).toBe(false);
  });

  it("updateOperatorAccountでusernameのみ指定した場合、パスワードは変わらない", () => {
    updateOperatorAccount({ username: "renamed-again" });
    expect(verifyOperatorPassword("renamed-again", "new-password")).toBe(true);
  });
});
