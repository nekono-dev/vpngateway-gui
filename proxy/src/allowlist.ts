// 責務: ランナーコンテナが実行してよいバイナリの許可リスト。APIコンテナが侵害・誤動作した場合でも、
// ランナー経由で任意コマンド実行の踏み台にならないための、コンテナ内部にある最後の防波堤
// （管理者向け設定・ユーザ向け設定とは独立したセキュリティ機構。proxyserver/design.md「ランナー」参照）。
//
// Phase 11: ランナーはベンダーごとに1つで、**自分のベンダーのバイナリ1つだけ**を許可する。許可するバイナリは
// 環境変数`RUNNER_ALLOWED_BINARY`で与え、実運用のイメージにはビルド時に`ENV`で焼き込む（composeでは上書きしない）。
// E2Eのモックランナー（docker-compose.e2e-mock.yml）のみ、composeでモックCLIのパスを与える。

/**
 * 目的: 受信した`binary`がこのランナーの許可バイナリか判定する。
 * 入力: 実行対象バイナリの絶対パス文字列。
 * 出力: `RUNNER_ALLOWED_BINARY`（絶対パス）に完全一致すれば true。環境変数が未設定・相対パスなら常に false
 *      （許可バイナリが決まらない構成では何も実行させない）。環境変数は呼び出しごとに読む（テストで切り替えるため）。
 * 例: // RUNNER_ALLOWED_BINARY=/usr/bin/protonvpn
 *     isAllowedBinary("/usr/bin/protonvpn") // => true
 *     isAllowedBinary("/bin/sh") // => false
 */
export function isAllowedBinary(binary: string): boolean {
  const allowed = process.env.RUNNER_ALLOWED_BINARY;
  if (allowed === undefined || !allowed.startsWith("/")) return false;
  return binary === allowed;
}

/**
 * 目的: このランナーの許可バイナリを返す（`GET /health`の応答用）。
 * 出力: `RUNNER_ALLOWED_BINARY`。未設定ならundefined。
 */
export function getAllowedBinary(): string | undefined {
  return process.env.RUNNER_ALLOWED_BINARY;
}
