// 責務: 文字列をURLパス・ファイル名に置ける小文字英数字とハイフンのみの文字列へ変換するのみを行う汎用ヘルパー。
// プロジェクト固有の型・モジュールに依存しない。

/**
 * 目的: 任意の文字列を、`a-z0-9`と`-`だけで構成されるslugへ変換する。
 * 入力: value(変換対象の文字列。分音記号付き文字や記号・空白を含んでよい), fallback(変換後に英数字が1文字も残らない場合に返す値)。
 * 出力: NFD正規化で分音記号を除去し小文字化した上で、英数字以外の連続を`-`1つに置き換え、前後の`-`を除いた文字列。
 * 失敗時の方針: 例外は投げず、英数字が残らない場合は`fallback`を返す。
 * 例: slugify("São Paulo", "x") // => "sao-paulo"
 *     slugify("Shanghai (Virtual)", "x") // => "shanghai-virtual"
 *     slugify("東京", "location") // => "location"
 */
export function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : fallback;
}
