// 責務: 迂回ドメインの表記（`example.com`＝完全一致、`*.example.com`＝サブドメインのみ）の検証と、
// 問い合わせ名との照合を行う純粋関数。proxyserver/design.md「ドメイン迂回とDNS中継」の照合規則に対応する。

export type DomainMatcher = (queryName: string) => boolean;

const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * 目的: 問い合わせ名・表記を比較用に正規化する（小文字化、末尾のドットの除去）。
 * 入力: name(ドメイン名または`*.`付きの表記)。
 * 出力: 正規化後の文字列。
 * 例: normalizeDomain("WWW.Example.COM.") // => "www.example.com"
 */
export function normalizeDomain(name: string): string {
  const lower = name.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

/**
 * 目的: 迂回ドメインの表記として妥当かを判定する。
 * 入力: pattern(`example.com`または`*.example.com`)。
 * 出力: 妥当なら true。ラベルは英数字・ハイフンで各63文字以内、全体253文字以内。先頭の`*.`以外の`*`、
 *      ラベルが1つだけのホスト名（`localhost`等）、空白・制御文字は false。
 * 失敗時の方針: 例外は投げず false を返す。
 */
export function isValidDomainPattern(pattern: string): boolean {
  const normalized = normalizeDomain(pattern);
  const body = normalized.startsWith("*.") ? normalized.slice(2) : normalized;
  if (body.length === 0 || body.length > 253) return false;
  const labels = body.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => LABEL_PATTERN.test(label));
}

/**
 * 目的: 迂回ドメインの表記の一覧から、問い合わせ名との照合関数を作る。
 * 入力: patterns(表記の一覧。不正な表記は無視する)。
 * 出力: 問い合わせ名が1つでも一致すれば true を返す関数。`example.com`は`example.com`のみ、
 *      `*.example.com`は複数階層を含むすべてのサブドメインに一致し、`example.com`自体には一致しない。
 * 例: createDomainMatcher(["example.com", "*.example.org"])("a.example.org") // => true
 */
export function createDomainMatcher(patterns: readonly string[]): DomainMatcher {
  const exact = new Set<string>();
  const suffixes: string[] = [];
  for (const pattern of patterns) {
    if (!isValidDomainPattern(pattern)) continue;
    const normalized = normalizeDomain(pattern);
    if (normalized.startsWith("*.")) {
      suffixes.push(normalized.slice(1));
    } else {
      exact.add(normalized);
    }
  }
  return (queryName) => {
    const name = normalizeDomain(queryName);
    if (exact.has(name)) return true;
    return suffixes.some((suffix) => name.length > suffix.length && name.endsWith(suffix));
  };
}
