// 責務: 文字列中の秘密情報（パスワード・認証コード等）を伏字に置き換える汎用ヘルパー。
// ドメイン非依存（プリミティブのみで完結）のためlib/に置く。

const MASK = "***";

/**
 * 目的: テキスト中に現れる秘密の文字列を全て伏字（***）に置き換える。
 *      CLIが入力（パスワード等）を出力へ反映した場合に、エラー応答へ秘密が残らないようにする保険。
 * 入力: text(対象の文字列), secrets(伏字にする文字列の配列。空文字列は無視する)。
 * 出力: 伏字化した文字列。secretsが空・一致なしならtextのまま。
 * 例: redactSecrets("bad password: hunter2", ["hunter2"]) // => "bad password: ***"
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    redacted = redacted.split(secret).join(MASK);
  }
  return redacted;
}
