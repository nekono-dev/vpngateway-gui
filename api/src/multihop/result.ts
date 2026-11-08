// 責務: 多段接続の計算結果を、成功と失敗の判別可能な共用体で表す小さな部品（例外を使わない戻り値の型）。

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
