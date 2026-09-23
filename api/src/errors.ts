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

// ベンダーの切替中に、ベンダーに対する他の操作（接続・ログイン等）が来た場合のエラー。409で通知する
// （切替の途中状態に対して操作を実行して、切替前後どちらのベンダーへ作用するか曖昧になるのを避けるため）。
export class ProviderSwitchingError extends Error {}

// Web UI利用者のセッションCookieが欠如・不正・期限切れの場合のエラー。401で通知する（Phase 25）。
export class UnauthenticatedError extends Error {}

// `PUT /v1/operator`でusername・newPasswordのいずれも指定しなかった場合のエラー。400で通知する（Phase 25）。
export class OperatorValidationError extends Error {}

// 単一管理者アカウントが既に作成済みの状態で`POST /v1/operator`が呼ばれた場合のエラー。409で通知する（Phase 25）。
export class OperatorAlreadyConfiguredError extends Error {}

// ログイン試行・パスワード変更の失敗回数が、送信元IPごとの制限を超えた場合のエラー。429で通知する（Phase 25）。
export class RateLimitedError extends Error {}
