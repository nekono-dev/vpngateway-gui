// 責務: 上流のDNSサーバ（自宅のDNSサーバ）がクライアントを識別するためのClientIDを、LANクライアントのIP、または
// 名前（DHCPサーバ・ルータが配る`macmini.lan`のような名前。逆引きで得る）から生成する。
// ClientIDの制約（小文字英数字とハイフン、63文字以内）に合わせる。proxyserver/design.md「DNS中継リゾルバ」のClientID参照。

// ゲートウェイ自身（3proxyからの問い合わせ）を表す固定のClientID。
export const LOCAL_CLIENT_ID = "explicit-proxy";
// ゲートウェイが、クライアントの名前を得るために自分で行う問い合わせ（上流への逆引き等）を表す固定のClientID。
export const GATEWAY_CLIENT_ID = "gateway";
const POSITIVE_CACHE_MS = 10 * 60_000;
// 名前が得られなかったときの保持期間。DHCPで新たに払い出された名前を、早めに取り込めるよう短くする。
const NEGATIVE_CACHE_MS = 2 * 60_000;
const LOOKUP_TIMEOUT_MS = 1000;
const MAX_CACHE_ENTRIES = 2048;
const MAX_LABEL_LENGTH = 63;

/**
 * 目的: 名前（例: `Macmini.lan.`）を、ClientIDに使える文字列（`macmini-lan`）へ整える。
 * 入力: name(逆引きで得た名前)。
 * 出力: 小文字化し、英数字以外の連続をハイフン1つにし、前後のハイフンを除き、63文字以内に切った文字列。空になるならundefined。
 * 例: sanitizeClientName("Macmini.lan.") // => "macmini-lan"
 */
export function sanitizeClientName(name: string): string | undefined {
  const label = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_LABEL_LENGTH).replace(/-+$/g, "");
  return label.length > 0 ? label : undefined;
}

/**
 * 目的: クライアントのIP、名前（あれば）からClientIDを作る。
 * 入力: clientIp(IPv4アドレス), name(逆引きで得た名前。無ければundefined)。
 * 出力: 名前があれば整えた名前（`macmini-lan`）、無ければIPのドットをハイフンにした`192-168-3-25`（ClientIDにドットは使えず、上流が拒否するため。実機で確認）。名前もIPも使えなければ`unknown-client`。
 */
export function buildClientId(clientIp: string, name: string | undefined): string {
  const fromName = name === undefined ? undefined : sanitizeClientName(name);
  if (fromName !== undefined) return fromName;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clientIp)) return clientIp.replaceAll(".", "-");
  return "unknown-client";
}

interface CacheEntry {
  id: string;
  expiresAt: number;
}

/**
 * 目的: クライアントIPからClientIDを引く。名前は逆引きで一度取得してキャッシュする（取得できなければIPベース）。
 */
export class ClientIdResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<string>>();

  /**
   * 入力: localAddresses(ゲートウェイ自身のアドレス。ここからの問い合わせは固定IDにする),
   *      lookupName(IPから名前を逆引きする関数。名前が無い・失敗はundefined。省略時は逆引きしない),
   *      now(現在時刻ms。テスト用フック), timeoutMs(逆引きの待ち時間。超えたらIPベースで進める)。
   */
  constructor(
    private readonly localAddresses: readonly string[] = ["127.0.0.1"],
    private readonly lookupName: (clientIp: string) => Promise<string | undefined> = async () => undefined,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs: number = LOOKUP_TIMEOUT_MS,
  ) {}

  async resolve(clientIp: string): Promise<string> {
    if (this.localAddresses.includes(clientIp)) return LOCAL_CLIENT_ID;
    const cached = this.cache.get(clientIp);
    if (cached !== undefined && cached.expiresAt > this.now()) return cached.id;
    // 同じクライアントの並行した問い合わせで、逆引きを重複させない。
    let inflight = this.pending.get(clientIp);
    if (inflight === undefined) {
      inflight = this.lookup(clientIp).finally(() => this.pending.delete(clientIp));
      this.pending.set(clientIp, inflight);
    }
    return inflight;
  }

  /** 目的: 設定（クライアント名の取得先）が変わったときに、保持している結果を捨てる。 */
  clear(): void {
    this.cache.clear();
  }

  private async lookup(clientIp: string): Promise<string> {
    let name: string | undefined;
    try {
      name = await Promise.race([
        this.lookupName(clientIp),
        new Promise<undefined>((resolve) => {
          const timer = setTimeout(() => resolve(undefined), this.timeoutMs);
          timer.unref();
        }),
      ]);
    } catch {
      name = undefined;
    }
    const id = buildClientId(clientIp, name);
    if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear();
    this.cache.set(clientIp, { id, expiresAt: this.now() + (name === undefined ? NEGATIVE_CACHE_MS : POSITIVE_CACHE_MS) });
    return id;
  }
}
