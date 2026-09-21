// 責務: Web UIの操作単位を表す「オペレーション」の固定語彙と、実行可否（capability）の型定義。
// プロバイダが増えても語彙は変えず、プロバイダごとの差は各オペレーションが可能か否かのデータで表す
// （specs/design.md「プロバイダ抽象化アーキテクチャ」）。

// UI操作との対応（webserver/requirements.md「操作の制限表示」）:
//   login=ログイン導線, logout=ログアウト, connectToLocation=接続先を指定した接続,
//   connectAuto=接続先を指定しない接続, changeLocation=接続中の接続先変更, disconnect=切断,
//   locationList=接続先一覧の取得, locationFavorites=お気に入り, pingMeasurement=ping値の計測（再計測）。
export const OPERATION_KEYS = [
  "login",
  "logout",
  "connectToLocation",
  "connectAuto",
  "changeLocation",
  "disconnect",
  "locationList",
  "locationFavorites",
  "pingMeasurement",
] as const;

export type OperationKey = (typeof OPERATION_KEYS)[number];

// 実行不可の原因。unsupported=プロバイダ非対応、notLoggedIn=未ログイン、planRestricted=プラン制限。
export type CapabilityReason = "unsupported" | "notLoggedIn" | "planRestricted";

export interface Capability {
  available: boolean;
  reason?: CapabilityReason;
  // 利用者向けの理由文（日本語）。実行不可のときのみ付く。
  message?: string;
}

export type CapabilityMap = Record<OperationKey, Capability>;
