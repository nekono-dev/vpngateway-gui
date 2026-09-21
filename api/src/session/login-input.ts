// 責務: ユーザー名・パスワード入力型ログイン（`loginMethod: "credentials"`）の入力検証と、
// CLIの標準入力へ渡す文字列の組み立て。パスワード等の秘密情報は標準入力にのみ渡す
// （apiserver/design.md「`POST /v1/session`の`credentials`方式の入力検証と受け渡し」）。

import { PlaceholderValidationError } from "../profile/placeholder-resolver.js";

// パスワードに許す長さ。上限はCLIへの過大な入力を避けるためのもの。
const PASSWORD_MAX_LENGTH = 512;
// 改行・NUL・制御文字を含めない。含むと標準入力へ余分な行が混入し、2FA入力の偽装等になるため。
// 制御文字そのものを検出するための正規表現のため、no-control-regexは意図的に無効化する。
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/;
// 2段階認証コード（TOTPの数字、リカバリーコードの英数字）。
const TWO_FACTOR_PATTERN = /^[0-9A-Za-z]{4,32}$/;

export interface LoginCredentials {
  username: string;
  password: string;
  twoFactorCode?: string;
}

/**
 * 目的: ログインのパスワード・2FAコードの形式を検証する（ユーザー名はプレースホルダー`USERNAME`のpatternで別途検証する）。
 * 入力: credentials(Webから受け取った値。password/twoFactorCodeを検証する)。
 * 出力: なし。
 * 失敗時の方針: 違反があればPlaceholderValidationError（HTTP 400）。エラーメッセージに入力値は含めない
 *              （秘密がエラー応答・ログへ残らないようにするため）。
 * 例: assertValidSecrets({ username: "u", password: "pass\nword" }) // => PlaceholderValidationError
 */
export function assertValidSecrets(credentials: LoginCredentials): void {
  const { password, twoFactorCode } = credentials;
  if (password.length === 0 || password.length > PASSWORD_MAX_LENGTH) {
    throw new PlaceholderValidationError("password length is out of range");
  }
  if (CONTROL_CHARACTER_PATTERN.test(password)) {
    throw new PlaceholderValidationError("password must not contain control characters");
  }
  if (twoFactorCode !== undefined && twoFactorCode !== "" && !TWO_FACTOR_PATTERN.test(twoFactorCode)) {
    throw new PlaceholderValidationError("twoFactorCode has an invalid format");
  }
}

/**
 * 目的: CLIの標準入力へ渡す文字列を組み立てる（パスワードの行、2FAコードがあればその行）。
 * 入力: credentials(assertValidSecretsで検証済みであること)。
 * 出力: 改行区切りの文字列（各行の末尾に`\n`）。2FAコードが空・未指定ならパスワードの1行のみ。
 *       Proton VPN CLIの`signin`はパスワード→（2FAが必要なときのみ）2FAトークンの順に読む。
 * 例: buildLoginStdin({ username: "u", password: "p", twoFactorCode: "123456" }) // => "p\n123456\n"
 */
export function buildLoginStdin(credentials: LoginCredentials): string {
  const lines = [credentials.password];
  if (credentials.twoFactorCode !== undefined && credentials.twoFactorCode !== "") {
    lines.push(credentials.twoFactorCode);
  }
  return lines.map((line) => `${line}\n`).join("");
}
