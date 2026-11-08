// 責務: 利用者の国を、保存された値・ブラウザの言語設定の地域の順に決める（純粋関数。保存や通信は行わない）。

/** 利用者の国の決定の結果。 */
export interface ResolvedUserLocation {
  // ISO 3166-1 alpha-2（大文字）。決まらなければ undefined。
  readonly country: string | undefined;
  // 決めた根拠: 保存された値、ブラウザの言語設定、無し。
  readonly source: "saved" | "browser" | "none";
}

/**
 * 目的: Accept-Language ヘッダから、言語タグの地域サブタグ（2 文字の英字）を、ヘッダに書かれた順に取り出す。
 * 入力: header（Accept-Language の値。省略可）。
 * 出力: 地域の配列（大文字の ISO 国コード）。地域を持つタグだけを対象にする。
 * 規則: タグの先頭（言語）の後ろを見て、文字種の 4 文字（Hant 等）と数字の地域（419 等）を飛ばし、
 *       最初の 2 文字の英字を地域とする。拡張（1 文字のサブタグ）の手前までを見る。品質値（q）では並べ替えない。
 * 例: parseAcceptLanguageRegions("en;q=0.8, zh-Hant-TW") // => ["TW"]
 */
export function parseAcceptLanguageRegions(header: string | undefined): string[] {
  if (header === undefined) return [];
  const regions: string[] = [];
  for (const entry of header.split(",")) {
    const tag = entry.split(";")[0].trim();
    if (tag === "" || tag === "*") continue;
    const subtags = tag.split("-").slice(1);
    for (const subtag of subtags) {
      if (subtag.length === 1) break; // 拡張の手前まで
      if (/^[A-Za-z]{2}$/.test(subtag)) {
        regions.push(subtag.toUpperCase());
        break;
      }
    }
  }
  return regions;
}

/**
 * 目的: 利用者の国を決める。
 * 入力: saved（運用者が保存した国コード。無ければ undefined）, acceptLanguage（要求の Accept-Language。省略可）,
 *       isKnownCountry（同梱データの国かどうかの判定）。
 * 出力: 保存された値が既知ならそれ（saved）。無ければ、ヘッダの地域のうち最初の既知の国（browser）。どちらも無ければ none。
 */
export function resolveUserLocation(input: {
  readonly saved: string | undefined;
  readonly acceptLanguage: string | undefined;
  readonly isKnownCountry: (code: string) => boolean;
}): ResolvedUserLocation {
  if (input.saved !== undefined && input.isKnownCountry(input.saved)) {
    return { country: input.saved, source: "saved" };
  }
  const fromBrowser = parseAcceptLanguageRegions(input.acceptLanguage).find(input.isKnownCountry);
  if (fromBrowser !== undefined) {
    return { country: fromBrowser, source: "browser" };
  }
  return { country: undefined, source: "none" };
}
