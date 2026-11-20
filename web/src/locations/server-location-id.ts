// 責務: サーバ名から、接続・お気に入りに使う接続先IDを作る（API の toServerLocationId と同じ規則）。
// API 側は受け取った ID がこの規則と一致するかを検査するため、ここで作る値は必ず API の規則に合わせること。

/**
 * 目的: サーバ名（例: `US-IL#834`）から接続先ID（例: `srv-us-il-834`）を作る。
 * 入力: name(サーバ名)。
 * 出力: `srv-` に続けて、小文字化し `#` を `-` に置き換えた文字列。
 * 例: toServerLocationId("US-IL#834") // => "srv-us-il-834"
 */
export function toServerLocationId(name: string): string {
  return `srv-${name.toLowerCase().replace(/#/g, "-")}`;
}
