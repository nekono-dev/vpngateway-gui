// 責務: 出口 IP の検証に必要な設定（透過ゲートウェイまたは明示的プロキシ）を有効にし、変更の前の値を記録し、試験の後に戻す（要件 8.1〜8.4）。

import type { ApiClient } from "../../common/api-client";

/** 試験の前の設定の値（復元に使う）。 */
export interface SettingsSnapshot {
  readonly transparentGatewayEnabled: boolean;
  readonly explicitProxyEnabled: boolean;
}

/** 有効化の結果。changed は、変更したキーの一覧（復元の対象）。 */
export type EnsureResult =
  | { ok: true; snapshot: SettingsSnapshot; changed: readonly (keyof SettingsSnapshot)[] }
  | { ok: false; reason: string };

/** 復元の結果。戻せなかったキーの名前と、記録していた値を返す（要件 8.4）。 */
export type RestoreResult = { ok: true } | { ok: false; failed: { name: keyof SettingsSnapshot; recorded: boolean }[] };

/** API の /v1/connection/config のうち、本ツールが読む部分。 */
interface ConfigBody {
  readonly transparentGatewayEnabled: boolean;
  readonly explicitProxyEnabled: boolean;
}

/**
 * 目的: 出口 IP の検証の前提（透過ゲートウェイまたは明示的プロキシのどちらか）を満たす。
 * 入力: api(管理者の Cookie を保持する API クライアント)。
 * 出力: 変更の前の値（snapshot）と、変更したキーの一覧（changed）。既に満たしていれば changed は空。
 * 失敗時の方針: 読み取りや更新に失敗したら、変更せずに理由を返す（呼び出し側は試験に進まない）。
 */
export async function ensureEgressPrerequisite(api: ApiClient): Promise<EnsureResult> {
  const read = await api.get<ConfigBody>("/v1/connection/config");
  if (!read.ok) return { ok: false, reason: "設定の読み取りに失敗した" };
  const snapshot: SettingsSnapshot = {
    transparentGatewayEnabled: read.body.transparentGatewayEnabled,
    explicitProxyEnabled: read.body.explicitProxyEnabled,
  };
  if (snapshot.transparentGatewayEnabled || snapshot.explicitProxyEnabled) {
    return { ok: true, snapshot, changed: [] };
  }

  // 変更するキーだけを部分更新で送る
  const write = await api.put("/v1/connection/config", { transparentGatewayEnabled: true });
  if (!write.ok) return { ok: false, reason: "設定の有効化に失敗した" };
  return { ok: true, snapshot, changed: ["transparentGatewayEnabled"] };
}

/**
 * 目的: 記録した値へ、変更したキーだけを部分更新で戻す。成功・失敗を問わず試験の後に呼ぶ。
 * 入力: api(API クライアント)、snapshot(変更の前の値)、changed(変更したキー)。
 * 出力: 全て戻れば ok。戻せなかったキーの名前と、記録していた値を failed として返す。
 * 失敗時の方針: 1 つのキーが戻らなくても残りは試みる。失敗の内容は端末に表示させ、手で直せるようにする。
 */
export async function restoreSettings(
  api: ApiClient,
  snapshot: SettingsSnapshot,
  changed: readonly (keyof SettingsSnapshot)[],
): Promise<RestoreResult> {
  const failed: { name: keyof SettingsSnapshot; recorded: boolean }[] = [];
  for (const name of changed) {
    const recorded = snapshot[name];
    const result = await api.put("/v1/connection/config", { [name]: recorded });
    if (!result.ok) failed.push({ name, recorded });
  }
  return failed.length === 0 ? { ok: true } : { ok: false, failed };
}
