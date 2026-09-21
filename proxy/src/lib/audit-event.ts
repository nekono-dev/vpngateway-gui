// 責務: 実行要求・結果を構造化ログ（JSON1行）として標準出力へ記録する（監査ログ。apiserver/design.md参照）。
// ネットワークコンテナ・ランナー共通。プリミティブ値のみに依存する汎用ヘルパー。

/**
 * 目的: 監査イベントを標準出力へ記録する。
 * 入力: event(ログに残すイベント種別と付随情報)。
 * 出力: なし（副作用としてstdoutへJSON1行を出力）。
 * 副作用: 監査目的のため、成功・失敗を問わず全リクエストを記録する。秘密情報（stdin等）は呼び出し側が含めない。
 */
export function logAuditEvent(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...event }));
}
