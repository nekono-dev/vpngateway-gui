// 責務: nftの読み取り結果（`nft list table`のテキスト、`nft -j list set`のJSON）を、設定の動作検証が照合しやすい形へ
// 変換する純粋関数群。nftは数値・集合の順序・CIDRの表記を正規化して出力するため（例: `256`→`0x00000100`、`/32`の省略）、
// ルール文字列の完全一致ではなく、チェーンごとのルール行として扱う（proxyserver/design.md「設定の動作検証」）。

export interface SetElement {
  address: string;
  // 要素の残り期限（秒）。期限の無い要素はundefined。
  expiresSeconds: number | undefined;
}

/**
 * 目的: `nft list table inet <テーブル>`のテキストから、チェーンごとのルール行を取り出す。
 * 入力: text(標準出力)。
 * 出力: チェーン名→ルール行（前後の空白を除く。`type ... hook ...`の宣言行は含めない）の対応。
 * 例: parseTableListing("table inet t {\n\tchain forward {\n\t\ttype filter hook forward priority filter; policy accept;\n\t\tiifname \"eth0\" drop\n\t}\n}")
 *     // => Map { "forward" => ["iifname \"eth0\" drop"] }
 */
export function parseTableListing(text: string): Map<string, string[]> {
  const chains = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const chainStart = /^chain (\S+) \{$/.exec(line);
    if (chainStart !== null) {
      current = [];
      chains.set(chainStart[1], current);
      continue;
    }
    if (current === undefined) continue;
    if (line === "}") {
      current = undefined;
      continue;
    }
    if (line.length === 0 || line.startsWith("type ")) continue;
    current.push(line);
  }
  return chains;
}

function toElement(value: unknown): SetElement | undefined {
  if (typeof value === "string") return { address: value, expiresSeconds: undefined };
  if (typeof value !== "object" || value === null) return undefined;
  const wrapper = (value as Record<string, unknown>).elem;
  if (typeof wrapper !== "object" || wrapper === null) return undefined;
  const elem = wrapper as Record<string, unknown>;
  if (typeof elem.val !== "string") return undefined;
  return { address: elem.val, expiresSeconds: typeof elem.expires === "number" ? elem.expires : undefined };
}

/**
 * 目的: `nft -j list set inet <テーブル> <set>`のJSONから、要素のアドレスと残り期限を取り出す。
 * 入力: json(標準出力)。
 * 出力: 要素の配列。setに要素が無ければ空配列。JSONとして不正、またはsetが見つからなければundefined。
 * 期待する入力形状: `{"nftables":[{"metainfo":...},{"set":{...,"elem":[{"elem":{"val":"10.0.0.1","expires":596}}, "10.0.0.2"]}}]}`
 *                （期限の無い要素は文字列のまま並ぶ）。
 */
export function parseSetElements(json: string): SetElement[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const items = (parsed as Record<string, unknown>).nftables;
  if (!Array.isArray(items)) return undefined;
  const set = items
    .map((item) => (typeof item === "object" && item !== null ? (item as Record<string, unknown>).set : undefined))
    .find((value) => typeof value === "object" && value !== null) as Record<string, unknown> | undefined;
  if (set === undefined) return undefined;
  if (!Array.isArray(set.elem)) return [];
  return set.elem.map((value) => toElement(value)).filter((element): element is SetElement => element !== undefined);
}
