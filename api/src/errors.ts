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
