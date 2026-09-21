// 責務: 「接続時に要求した接続先（接続先IDと国コード）」の永続化と、実際の接続状態との突き合わせ。
// 実CLIの`status`は国コードではなく都市名しか出力しないため（例: "Connected to TOKYO in TUN mode"）、
// APIが接続成功時に要求した接続先を保存し、`GET /v1/connection`で返す（apiserver/design.md「接続先国の永続化」）。
// Web UIのリロード・別端末からの閲覧でも接続先を表示できるよう、クライアントではなくAPI側（データボリューム）に保存する。
// 切断で消える「現在の接続先」であり、切断後も残る「最後に接続した接続先」は locations/last-location-store.ts が担う。
// 単一JSONファイルへのread-modify-write（低頻度更新のため。settings-store.tsと同方針で競合は考慮しない）。

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConnectionStatus } from "../schemas/connection.js";

const STATE_FILE = process.env.CONNECTION_STATE_FILE ?? "/var/lib/vpngwgui/connection-state.json";

interface StoredConnection {
  country: string;
  // 接続先ID（locations/location-id.ts）。Phase 8より前に保存されたファイルには無い。
  locationId?: string;
  // 接続成功時にCLIが報告した接続先の都市名。読み取れなかった場合はundefined。
  location?: string;
}

/**
 * 目的: 保存済みの接続情報を読み出す。
 * 出力: 保存内容。未保存・破損（JSON不正・形状不正）の場合はundefined（国を表示しないだけで動作は継続する）。
 */
function readStored(): StoredConnection | undefined {
  if (!existsSync(STATE_FILE)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { country, location, locationId } = parsed as Record<string, unknown>;
    if (typeof country !== "string" || country.length === 0) return undefined;
    return {
      country,
      location: typeof location === "string" ? location : undefined,
      locationId: typeof locationId === "string" ? locationId : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * 目的: 接続成功時に、要求した接続先（ID・国コード）と、CLIが報告した都市名を保存する。
 * 入力: requested(接続時に要求した接続先の`{ locationId, country }`), location(CLIが報告した都市名。不明ならundefined)。
 * 副作用: STATE_FILEへ書き込む（ディレクトリが無ければ作成）。
 * 例: saveConnectedLocation({ locationId: "jp-tokyo", country: "jp" }, "TOKYO")
 */
export function saveConnectedLocation(
  requested: { locationId: string; country: string },
  location: string | undefined,
): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ ...requested, location }));
}

/**
 * 目的: 保存済みの接続情報を消去する（切断時・切断の観測時・接続先の不一致時）。
 * 副作用: STATE_FILEを削除する。無ければ何もしない。
 */
export function clearConnectedLocation(): void {
  rmSync(STATE_FILE, { force: true });
}

/**
 * 目的: CLIから観測した接続状態に、保存済みの国コード・接続先IDを突き合わせて付与する。
 * 入力: observed(`status`コマンド出力から得た接続状態)。
 * 出力: 接続中かつ保存済みの接続先と整合すれば`country`（と、保存されていれば`locationId`）を付与した状態。
 *       それ以外は付与なし。
 * 副作用（整合性維持）: 切断を観測した場合、または接続先の都市名が保存時と異なる（別経路で再接続された）
 *   場合は、古い接続先を返し続けないよう保存内容を消去する。都市名がどちらかで不明な場合は判定できないため
 *   保存内容を信頼する。
 * 例: reconcileLocation({ status: "connected", location: "TOKYO" })
 *     // => { status: "connected", location: "TOKYO", country: "jp", locationId: "jp-tokyo" }
 */
export function reconcileLocation(observed: ConnectionStatus): ConnectionStatus {
  if (observed.status !== "connected") {
    clearConnectedLocation();
    return observed;
  }
  const stored = readStored();
  if (!stored) return observed;
  if (stored.location && observed.location && stored.location !== observed.location) {
    clearConnectedLocation();
    return observed;
  }
  return { ...observed, country: stored.country, ...(stored.locationId ? { locationId: stored.locationId } : {}) };
}
