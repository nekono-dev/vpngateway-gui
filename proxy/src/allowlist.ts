// 責務: APIコンテナが侵害・誤動作した場合でも任意コマンド実行の踏み台にならないための、
// プロキシコンテナ内部にハードコードされた実行可能バイナリ許可リスト。
// 管理者向け設定・ユーザ向け設定とは独立したセキュリティ機構（proxyserver/design.md参照）。

// Phase 2で実VPNベンダーCLI（AdGuard VPN CLI）に置換した。モックCLIのパスは含めない。
const ALLOWED_BINARIES: readonly string[] = [
  "/usr/local/bin/adguardvpn-cli",
];

/**
 * 目的: 受信した`binary`が許可リストに含まれるかを判定する。
 * 入力: 実行対象バイナリの絶対パス文字列。
 * 出力: 許可リストに完全一致すれば true、それ以外は false。
 * 例: isAllowedBinary("/usr/local/bin/adguardvpn-cli") // => true
 */
export function isAllowedBinary(binary: string): boolean {
  return ALLOWED_BINARIES.includes(binary);
}
