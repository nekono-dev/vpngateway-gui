// 責務: ログイン試行・パスワード変更のレート制限（送信元IPごと、プロセスメモリ保持）。
// apiserver/design.md「Web UI利用者の認証」: 直近1分間の失敗回数が既定5回を超えたIPからの
// リクエストを429で拒否する。APIコンテナ再起動でリセットされる。

const WINDOW_MS = 60_000;
const MAX_FAILURES_PER_WINDOW = 5;

const failureTimestampsByIp = new Map<string, number[]>();

function recentFailures(ip: string, now: number): number[] {
  return (failureTimestampsByIp.get(ip) ?? []).filter((timestamp) => now - timestamp < WINDOW_MS);
}

/**
 * 目的: 送信元IPが直近1分間の失敗回数の上限を超えているかを判定する。
 * 入力: ip(送信元IPアドレス)。
 * 出力: 上限超過ならtrue。
 */
export function isRateLimited(ip: string): boolean {
  return recentFailures(ip, Date.now()).length >= MAX_FAILURES_PER_WINDOW;
}

/**
 * 目的: ログイン・パスワード変更の失敗を記録する。
 * 入力: ip(送信元IPアドレス)。
 * 副作用: failureTimestampsByIpへ現在時刻を追加する（期限切れの記録は同時に間引く）。
 */
export function recordFailure(ip: string): void {
  const now = Date.now();
  const timestamps = recentFailures(ip, now);
  timestamps.push(now);
  failureTimestampsByIp.set(ip, timestamps);
}

/**
 * 目的: 送信元IPの失敗記録を消す（成功時に呼ぶ）。
 * 入力: ip(送信元IPアドレス)。
 * 副作用: failureTimestampsByIpから削除する。
 */
export function clearFailures(ip: string): void {
  failureTimestampsByIp.delete(ip);
}
