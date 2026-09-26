// 責務: 文字列がIPv4 CIDR表記（例 192.168.1.0/24）として妥当かを判定する汎用ヘルパー。
// プロジェクト固有の型・モジュールに依存しない（AGENTS.md「lib / util の使い分け」）。

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

function toUint32(address: string): number | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (match === null) return undefined;
  const octets = match.slice(1).map((octet) => Number(octet));
  if (octets.some((octet) => octet > 255)) return undefined;
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

/**
 * 目的: IPv4アドレスがIPv4 CIDRの範囲に含まれるかを判定する。
 * 入力: address(IPv4アドレス), cidr(IPv4 CIDR)。
 * 出力: 含まれればtrue。どちらかの形式が不正ならfalse。
 * 例: isIpv4InCidr("192.168.3.240", "192.168.3.0/24") // => true
 */
export function isIpv4InCidr(address: string, cidr: string): boolean {
  if (!isIpv4Cidr(cidr)) return false;
  const [network, prefix] = cidr.split("/");
  const target = toUint32(address);
  const base = toUint32(network);
  if (target === undefined || base === undefined) return false;
  const prefixLength = Number(prefix);
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return ((target & mask) >>> 0) === ((base & mask) >>> 0);
}
