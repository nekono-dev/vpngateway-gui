// 責務: 文字列がIPv4アドレス表記（例 192.168.1.1）として妥当かを判定する汎用ヘルパー。
// プロジェクト固有の型・モジュールに依存しない（AGENTS.md「lib / util の使い分け」）。

/**
 * 目的: 文字列がIPv4アドレス（`a.b.c.d`、各オクテット0〜255）かを判定する。
 * 入力: value(検証対象の文字列。外部入力のため任意の値を許容する)。
 * 出力: 妥当なら true。前後の空白・改行・プレフィックス長付き（CIDR）は false。
 * 失敗時の方針: 例外は投げず false を返す。
 * 例: isIpv4Address("1.1.1.1") // => true / isIpv4Address("1.1.1.1/32") // => false
 */
export function isIpv4Address(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (match === null) return false;
  return match.slice(1, 5).every((octet) => Number(octet) <= 255);
}
