// 責務: APIコンテナが侵害・誤動作した場合でも任意コマンド実行の踏み台にならないための、
// プロキシコンテナ内部にハードコードされた実行可能バイナリ許可リスト。
// 管理者向け設定・ユーザ向け設定とは独立したセキュリティ機構（proxyserver/design.md参照）。

// Phase 2で実VPNベンダーCLI（AdGuard VPN CLI）に置換した。モックCLIのパスは含めない。
// Phase 10でProton VPN CLIを追加した（対応するイメージにのみ実在する。無い環境では実行が失敗するだけ）。
const ALLOWED_BINARIES: readonly string[] = [
  "/usr/local/bin/adguardvpn-cli",
  "/usr/bin/protonvpn",
];

/**
 * 目的: 環境変数`EXTRA_ALLOWED_BINARIES`（カンマ区切りの絶対パス）から追加の許可バイナリを読む。
 *      モックプロバイダCLIを使うE2E（docker-compose.e2e-mock.yml）専用で、本番のcomposeでは設定しない
 *      （proxyserver/design.md「検証用の追加許可バイナリ」）。設定できるのはコンテナを起動する管理者のみで、
 *      APIコンテナからは変更できないため、許可リストの目的（API侵害時の踏み台防止）は損なわれない。
 * 入力: 環境変数（呼び出しごとに読む。テストで切り替えられるようにするため）。
 * 出力: 絶対パス（`/`始まり）のみを残した配列。未設定・空なら空配列。相対パス・空要素は無視する
 *      （PATH探索で意図しないバイナリが選ばれるのを防ぐ）。
 * 例: EXTRA_ALLOWED_BINARIES="/usr/local/bin/protonvpn-mock, bad" // => ["/usr/local/bin/protonvpn-mock"]
 */
function readExtraAllowedBinaries(): string[] {
  const raw = process.env.EXTRA_ALLOWED_BINARIES ?? "";
  return raw
    .split(",")
    .map((path) => path.trim())
    .filter((path) => path.startsWith("/"));
}

/**
 * 目的: 受信した`binary`が許可リストに含まれるかを判定する。
 * 入力: 実行対象バイナリの絶対パス文字列。
 * 出力: 許可リスト（`EXTRA_ALLOWED_BINARIES`の追加分を含む）に完全一致すれば true、それ以外は false。
 * 例: isAllowedBinary("/usr/local/bin/adguardvpn-cli") // => true
 */
export function isAllowedBinary(binary: string): boolean {
  return ALLOWED_BINARIES.includes(binary) || readExtraAllowedBinaries().includes(binary);
}
