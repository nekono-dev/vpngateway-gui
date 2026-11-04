// 責務: 試験ごとの管理者の資格情報を、乱数で作る（リポジトリに固定の資格情報を置かない。要件 2.x・12.x）。

import { randomBytes } from "node:crypto";

/** 試験で使う管理者の資格情報。実行ごとに変わる。 */
export interface AdminCredentials {
  readonly username: string;
  readonly password: string;
}

/**
 * 目的: 実行ごとに異なる管理者の資格情報を作る。
 * 出力: ユーザー名（英数字）とパスワード（英数字と記号。最小 12 文字）。
 */
export function makeAdminCredentials(): AdminCredentials {
  return {
    username: `admin${randomBytes(3).toString("hex")}`,
    password: `Pw-${randomBytes(9).toString("base64url")}`,
  };
}
