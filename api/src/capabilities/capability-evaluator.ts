// 責務: プロファイル・ログイン状態・プラン・学習した制限から、オペレーションごとの実行可否（capability）を算出する。
// 純粋関数のみで、I/Oを持たない（apiserver/design.md「オペレーションと実行可否（capability）」）。

import type { VendorProfile } from "../profile/profile.schema.js";
import type { Capability, CapabilityMap, OperationKey } from "./operations.js";

// 判定済みのログイン状態・プラン。`loggedIn`が未定義なら不明（判定できない場合は制限しない）。
export interface SessionInfo {
  loggedIn?: boolean;
  plan?: {
    id: string;
    label: string;
    restricts: OperationKey[];
    restrictionMessage?: string;
  };
}

const MESSAGE_UNSUPPORTED = "このVPNプロバイダでは利用できません";
const MESSAGE_NOT_LOGGED_IN = "ログインしてください";

// 未ログインのとき実行できないオペレーション（`disconnect`・`login`は常に可能）。
const REQUIRES_LOGIN: readonly OperationKey[] = ["logout", "connectToLocation", "connectAuto", "locationList"];

const AVAILABLE: Capability = { available: true };

/**
 * 目的: プロファイルがそのオペレーションに必要なアクション・機能を備えるか（プロバイダ対応）を判定する。
 *      依存するオペレーション（changeLocation等）は、この関数では自身の条件のみを見る（親の可否は呼び出し側で継承する）。
 * 入力: profile(検証済みプロファイル), operation(対象のオペレーション)。
 * 出力: 対応していればtrue。
 */
function isSupportedByProfile(profile: VendorProfile, operation: OperationKey): boolean {
  const { actions, features } = profile;
  switch (operation) {
    case "login":
      return actions.login !== undefined;
    case "logout":
      return actions.logout !== undefined;
    case "disconnect":
      return true;
    case "connectToLocation":
      return actions.connect !== undefined && actions.listLocations !== undefined;
    case "connectAuto":
      return actions.connectAuto !== undefined;
    case "locationList":
      return actions.listLocations !== undefined;
    case "changeLocation":
      return features?.changeLocation !== false;
    case "locationFavorites":
      return true;
    case "pingMeasurement":
      return features?.locationPing !== false;
  }
}

// 依存するオペレーションと、その親。親が実行不可なら原因ごと継承する。
const PARENT_OF: Partial<Record<OperationKey, OperationKey>> = {
  changeLocation: "connectToLocation",
  locationFavorites: "locationList",
  pingMeasurement: "locationList",
};

/**
 * 目的: 全オペレーションの実行可否を算出する。
 * 入力: profile(検証済みプロファイル), session(判定済みのログイン状態・プラン。不明なら空オブジェクト),
 *       learned(実行失敗から学習した制限。オペレーション→理由文)。
 * 出力: 全オペレーションのキーを持つCapabilityMap。
 *       原因の優先順は unsupported > notLoggedIn > planRestricted。未ログインと判定できないとき（不明）は
 *       notLoggedInにしない。依存するオペレーションは親の原因を継承する。接続先の指定（connectToLocation）と
 *       一覧（locationList）は相互に依存し、一方が実行不可なら他方も同じ原因で実行不可にする。
 * 例: evaluateCapabilities(profile, { loggedIn: true, plan: freePlan }, new Map()).connectToLocation
 *     // => { available: false, reason: "planRestricted", message: "無料プランでは接続先を選べません。…" }
 */
export function evaluateCapabilities(
  profile: VendorProfile,
  session: SessionInfo,
  learned: ReadonlyMap<OperationKey, string>,
): CapabilityMap {
  const result: Partial<CapabilityMap> = {};

  /** 親を持たないオペレーション、または親が可のオペレーションの、自身の条件での可否。 */
  function evaluateOwn(operation: OperationKey): Capability {
    if (!isSupportedByProfile(profile, operation)) {
      return { available: false, reason: "unsupported", message: MESSAGE_UNSUPPORTED };
    }
    if (session.loggedIn === false && REQUIRES_LOGIN.includes(operation)) {
      return { available: false, reason: "notLoggedIn", message: MESSAGE_NOT_LOGGED_IN };
    }
    const learnedMessage = learned.get(operation);
    if (session.plan?.restricts.includes(operation)) {
      const message = session.plan.restrictionMessage ?? `現在のプラン（${session.plan.label}）では利用できません`;
      return { available: false, reason: "planRestricted", message };
    }
    if (learnedMessage !== undefined) {
      return { available: false, reason: "planRestricted", message: learnedMessage };
    }
    return AVAILABLE;
  }

  // 依存の無いオペレーションを先に評価する。
  const independents: OperationKey[] = ["login", "logout", "disconnect", "connectAuto", "connectToLocation", "locationList"];
  for (const operation of independents) {
    result[operation] = evaluateOwn(operation);
  }
  // 接続先の指定（connectToLocation）と一覧（locationList）は互いに依存する。接続先を指定できないなら一覧を選べても意味が無く、
  // 一覧を取得できないなら接続先を解決できない。一方だけが実行不可なら、もう一方も同じ原因で実行不可にする。
  const connectToLocation = result.connectToLocation!;
  const locationList = result.locationList!;
  if (connectToLocation.available && !locationList.available) {
    result.connectToLocation = { ...locationList };
  } else if (!connectToLocation.available && locationList.available) {
    result.locationList = { ...connectToLocation };
  }

  // 依存するオペレーションは親の結果を見て継承する。
  for (const operation of ["changeLocation", "locationFavorites", "pingMeasurement"] as const) {
    const parent = PARENT_OF[operation];
    // 自身が非対応（機能フラグがfalse等）ならその原因を優先し、対応していて親が実行不可なら親の原因を継承する。
    const own = evaluateOwn(operation);
    const parentCapability = parent ? result[parent] : undefined;
    result[operation] = own.available && parentCapability && !parentCapability.available ? { ...parentCapability } : own;
  }
  return result as CapabilityMap;
}
