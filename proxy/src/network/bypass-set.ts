// 責務: ドメイン迂回の対象IPv4アドレスと期限をメモリ上に保持する。nftのsetはルールセットの再構成（原子的な置換）で
// 内容が失われるため、有効な要素をここで保持しておき、再構成のたびに新しいテーブルへ引き継ぐ
// （proxyserver/design.md「ドメイン迂回とDNS中継」の「nft set・ポリシールーティング」）。

// 応答のTTLに加える猶予（秒）。クライアント側のキャッシュがTTLを超えて保持される場合の取りこぼしを減らす。
export const BYPASS_GRACE_SECONDS = 60;
// 異常に長いTTLでsetが膨らまないようにする上限（秒）。
const MAX_TTL_SECONDS = 3600;

export interface BypassAddressInput {
  address: string;
  // DNS応答のTTL（秒）。
  ttl: number;
}

export interface LiveBypassEntry {
  address: string;
  // 現時点での残り期限（秒。1以上）。
  timeoutSeconds: number;
}

export class BypassSet {
  private readonly expiresAt = new Map<string, number>();

  /**
   * 入力: now(現在時刻ms。テスト用フック)。
   */
  constructor(private readonly now: () => number = Date.now) {}

  /**
   * 目的: 迂回対象のアドレスを登録（すでにあれば期限を延長）する。
   * 入力: addresses(応答のAレコード)。0.0.0.0・ループバック等の迂回に意味のないアドレスは登録しない。
   * 出力: 実際に登録したアドレスと期限（nftへ追加する要素）。
   */
  add(addresses: readonly BypassAddressInput[]): LiveBypassEntry[] {
    const added: LiveBypassEntry[] = [];
    for (const { address, ttl } of addresses) {
      if (!isBypassableAddress(address)) continue;
      const timeoutSeconds = Math.min(Math.max(ttl, 0), MAX_TTL_SECONDS) + BYPASS_GRACE_SECONDS;
      const expiry = this.now() + timeoutSeconds * 1000;
      const current = this.expiresAt.get(address);
      if (current === undefined || expiry > current) this.expiresAt.set(address, expiry);
      added.push({ address, timeoutSeconds });
    }
    return added;
  }

  /**
   * 目的: 期限内の要素を、残り期限つきで返す（期限切れは取り除く）。
   */
  live(): LiveBypassEntry[] {
    const now = this.now();
    const entries: LiveBypassEntry[] = [];
    for (const [address, expiry] of this.expiresAt) {
      if (expiry <= now) {
        this.expiresAt.delete(address);
        continue;
      }
      entries.push({ address, timeoutSeconds: Math.max(1, Math.ceil((expiry - now) / 1000)) });
    }
    return entries;
  }

  size(): number {
    return this.live().length;
  }

  clear(): void {
    this.expiresAt.clear();
  }
}

/**
 * 目的: 迂回の対象にしてよいIPv4アドレスかを判定する。
 * 出力: 形式が正しく、0.0.0.0（フィルタのブロック応答）・ループバック・リンクローカルでなければtrue。
 */
export function isBypassableAddress(address: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (match === null) return false;
  const octets = match.slice(1).map((octet) => Number(octet));
  if (octets.some((octet) => octet > 255)) return false;
  if (octets[0] === 0 || octets[0] === 127) return false;
  if (octets[0] === 169 && octets[1] === 254) return false;
  return true;
}
