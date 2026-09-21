// 責務: proxy-client（UDS経由のプロキシ通信）で発生しうるエラーを分類するためのエラークラス群。
// apiserver/design.md「エラーハンドリング方針」の分類（502/422/504）にそのまま対応する。

export class ProxyUnavailableError extends Error {}

export class ProxyTimeoutError extends Error {}

export class CommandExecutionError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message);
  }
}

// プラン制限を理由にCLIが失敗した（プロファイルの`restrictedPattern`に一致した）場合のエラー。
// 通常の実行失敗（CommandExecutionError→422）とは区別して403で通知する
// （apiserver/design.md「実行失敗からの学習」）。
export class OperationRestrictedError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message);
  }
}

// プロファイルがその操作に対応するアクションを持たない（プロバイダ非対応）場合のエラー。501で通知する。
export class OperationUnsupportedError extends Error {}
