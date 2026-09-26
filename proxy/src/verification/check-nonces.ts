// 責務: 設定の動作検証で使う使い捨ての名前（検証名）の登録と、中継リゾルバでの受信の記録（メモリ上のみ）。
// 53番リダイレクトの確認（`dns-redirect-path`）で、Web UIを開いている端末のブラウザが解決した検証名が、中継リゾルバに
// 届いたか、その問い合わせが53番リダイレクトで誘導されたものかを保持する（proxyserver/design.md「設定の動作検証」）。
// 端末のIP・名前は保持しない。

// 検証名の形式（APIサーバが発行する`vpngw-<乱数>.<ドメイン>`）。登録の入力検証に使う。
const CHECK_NAME_PATTERN = /^vpngw-[a-z0-9]{8,32}(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const MAX_TTL_SECONDS = 300;
const MAX_ENTRIES = 16;

export interface CheckNonceRecord {
  received: boolean;
  // 受信した問い合わせが、53番リダイレクトで誘導されたものか（受信していなければfalse）。
  redirected: boolean;
}

interface Entry extends CheckNonceRecord {
  expiresAt: number;
}

/** 目的: 登録できる検証名・有効期間かを判定する。 */
export function isValidCheckNonce(name: string, ttlSeconds: number): boolean {
  return name.length <= 253 && CHECK_NAME_PATTERN.test(name) && Number.isInteger(ttlSeconds) && ttlSeconds >= 1 && ttlSeconds <= MAX_TTL_SECONDS;
}

export class CheckNonceRegistry {
  private readonly entries = new Map<string, Entry>();

  /** 入力: now(現在時刻ms。テスト用フック)。 */
  constructor(private readonly now: () => number = Date.now) {}

  /**
   * 目的: 検証名を登録する（同じ名前の再登録は、受信の記録を消して期限を延ばす）。
   * 入力: name(検証名), ttlSeconds(有効期間)。形式はisValidCheckNonceで検証済みであること。
   */
  register(name: string, ttlSeconds: number): void {
    this.prune();
    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(name.toLowerCase(), { received: false, redirected: false, expiresAt: this.now() + ttlSeconds * 1000 });
  }

  /** 目的: 期限内の登録済みの名前かを判定する（中継リゾルバが、問い合わせを横取りするかの判定に使う）。 */
  has(name: string): boolean {
    const entry = this.entries.get(name.toLowerCase());
    return entry !== undefined && entry.expiresAt > this.now();
  }

  /**
   * 目的: 登録済みの名前の受信を記録する。誘導された問い合わせを一度でも受信していれば、誘導ありとして残す。
   * 入力: name(問い合わせ名), redirected(その問い合わせが53番リダイレクトで誘導されたか)。
   */
  markReceived(name: string, redirected: boolean): void {
    const entry = this.entries.get(name.toLowerCase());
    if (entry === undefined || entry.expiresAt <= this.now()) return;
    entry.received = true;
    entry.redirected = entry.redirected || redirected;
  }

  /** 目的: 受信の記録を返す。未登録・期限切れはundefined。 */
  get(name: string): CheckNonceRecord | undefined {
    const entry = this.entries.get(name.toLowerCase());
    if (entry === undefined || entry.expiresAt <= this.now()) return undefined;
    return { received: entry.received, redirected: entry.redirected };
  }

  private prune(): void {
    const now = this.now();
    for (const [name, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(name);
    }
  }
}
