// 責務: 文字列がIPv4 CIDR表記（例 192.168.1.0/24）として妥当かを判定する汎用ヘルパー。
// プロジェクト固有の型・モジュールに依存しない（AGENTS.md「lib / util の使い分け」。
// api/src/lib/ipv4-cidr.ts・proxy/src/lib/ipv4-cidr.tsと同内容。パッケージをまたぐ共有importは行わない方針のため複製）。

/**
 * 目的: 文字列がIPv4 CIDR（`a.b.c.d/n`、各オクテット0〜255、プレフィックス長0〜32）かを判定する。
 * 入力: value(検証対象の文字列。外部入力のため任意の値を許容する)。
 * 出力: 妥当なら true。前後の空白・改行・プレフィックス長省略（単一ホスト表記）は false。
 * 失敗時の方針: 例外は投げず false を返す（呼び出し元が拒否・除外を決める）。
 * 例: isIpv4Cidr("192.168.3.0/24") // => true / isIpv4Cidr("192.168.3.0/33") // => false
 */
export function isIpv4Cidr(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value);
  if (match === null) return false;
  const octets = match.slice(1, 5).map((octet) => Number(octet));
  const prefixLength = Number(match[5]);
  return octets.every((octet) => octet <= 255) && prefixLength <= 32;
}
