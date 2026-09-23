// 責務: Web UI利用者の単一管理者アカウント（ユーザー名・scryptハッシュ化パスワード）の永続化。
// apiserver/design.md「Web UI利用者の認証」の保存形式（`$STATE_DIR/operator-account.json`）に対応する。
// settings-store.tsと同様、単一JSONファイルへのread-modify-write（低頻度更新・単一アカウントのため）。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { stateDir } from "../providers/provider-state-paths.js";
import { OperatorAlreadyConfiguredError } from "../errors.js";

interface OperatorAccountRecord {
  username: string;
  algorithm: "scrypt";
  salt: string;
  hash: string;
}

// scryptの鍵長（バイト）。値自体に意味はなく、ハッシュ化・検証で一貫していればよい。
const SCRYPT_KEY_LENGTH = 64;

function accountFilePath(): string {
  return join(stateDir(), "operator-account.json");
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");
}

/**
 * 目的: 永続化済みのアカウント情報を取得する。
 * 入力: なし。
 * 出力: OperatorAccountRecord。未作成ならnull。
 */
export function getOperatorAccount(): OperatorAccountRecord | null {
  const path = accountFilePath();
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * 目的: アカウントが作成済みかを判定する。
 * 出力: 作成済みならtrue。
 */
export function isOperatorConfigured(): boolean {
  return getOperatorAccount() !== null;
}

/**
 * 目的: アカウントを初回作成する。
 * 入力: username, password(平文。ここでハッシュ化する)。
 * 出力: なし。
 * 失敗時の方針: 既に作成済みならOperatorAlreadyConfiguredErrorを投げる（呼び出し元で409へマッピング）。
 * 副作用: accountFilePath()へ書き込む。
 */
export function createOperatorAccount(username: string, password: string): void {
  if (isOperatorConfigured()) {
    throw new OperatorAlreadyConfiguredError("operator account is already configured");
  }
  const salt = randomBytes(16).toString("hex");
  const record: OperatorAccountRecord = { username, algorithm: "scrypt", salt, hash: hashPassword(password, salt) };
  const path = accountFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2));
}

/**
 * 目的: 指定したユーザー名・パスワードが、保存済みアカウントと一致するかを検証する。
 * 入力: username, password(いずれも平文)。
 * 出力: 一致すればtrue（アカウント未作成・ユーザー名不一致・パスワード不一致はいずれもfalse。
 *       未作成であることを検証結果から区別できないようにするため、同じfalseで応答する）。
 */
export function verifyOperatorPassword(username: string, password: string): boolean {
  const account = getOperatorAccount();
  if (!account || account.username !== username) {
    return false;
  }
  const candidate = Buffer.from(hashPassword(password, account.salt), "hex");
  const stored = Buffer.from(account.hash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

/**
 * 目的: ユーザー名・パスワードを変更する（呼び出し元が現在のパスワード確認を済ませていること）。
 * 入力: patch(username・newPasswordのいずれか省略可。省略した項目は変更しない)。
 * 出力: なし。
 * 副作用: accountFilePath()を上書きする。newPassword指定時はsaltも再生成する。
 */
export function updateOperatorAccount(patch: { username?: string; newPassword?: string }): void {
  const account = getOperatorAccount();
  if (!account) {
    // 呼び出し元（PUT /v1/operator）は既存アカウントとの現在パスワード照合を済ませてから呼ぶため、
    // ここに到達する場合は呼び出し順序の誤り（プログラミングエラー）であり、HTTPエラーへのマッピングは不要。
    throw new Error("updateOperatorAccount called without an existing operator account");
  }
  const salt = patch.newPassword !== undefined ? randomBytes(16).toString("hex") : account.salt;
  const hash = patch.newPassword !== undefined ? hashPassword(patch.newPassword, salt) : account.hash;
  const next: OperatorAccountRecord = { username: patch.username ?? account.username, algorithm: "scrypt", salt, hash };
  writeFileSync(accountFilePath(), JSON.stringify(next, null, 2));
}
