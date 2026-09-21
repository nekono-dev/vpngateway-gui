// 責務: Web UIで選択された「選択中のベンダー」の永続化と取得。全てのベンダー操作（接続・切断・ログイン・接続先一覧等）は
// 選択中のベンダーを対象にする（apiserver/design.md「ベンダーの選択」）。サーバ側に保持することで、ブラウザの再読み込み・
// 別端末・別ブラウザでも同じベンダーが選択される。単一JSONファイル（`$STATE_DIR/active-provider.json`）の上書き保存。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findProvider, getProviders, type Provider } from "./provider-registry.js";
import { stateDir } from "./provider-state-paths.js";

function activeFile(): string {
  return join(stateDir(), "active-provider.json");
}

/**
 * 目的: 選択中のベンダーを返す。
 * 入力: なし。
 * 出力: 保存されたIDに対応する有効なProvider。
 * 失敗時の方針: ファイルが無い・壊れている・有効でないID（管理者が無効化した等）の場合は例外にせず、
 *              有効なベンダーの先頭を選択中として返す（ベンダーが選べず操作不能になるのを避ける）。
 * 例: getActiveProvider().id // => "adguardvpn"
 */
export function getActiveProvider(): Provider {
  const file = activeFile();
  if (existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      const id = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).id : undefined;
      const provider = typeof id === "string" ? findProvider(id) : undefined;
      if (provider) return provider;
    } catch {
      // 破損は未保存として扱う。
    }
  }
  return getProviders()[0];
}

/**
 * 目的: 選択中のベンダーを保存する。
 * 入力: providerId(有効なベンダーのID。検証は呼び出し側で済んでいること)。
 * 副作用: `$STATE_DIR/active-provider.json`へ書き込む（ディレクトリが無ければ作成）。
 */
export function saveActiveProviderId(providerId: string): void {
  const file = activeFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ id: providerId }));
}
