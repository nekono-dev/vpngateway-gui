// 責務: 準備処理の型（段・中止の理由・結果・入力の依存）。準備処理と、ベンダーの認証の両方が使う。

import type { ApiClient } from "../../common/api-client";

/** 準備処理の段。 */
export type PrepareStep = "api" | "operator" | "public-ip" | "vendor";

/** 中止の理由。端末にはこの種類に対応する文言を表示する。 */
export type AbortReason =
  | { kind: "api-unreachable" }
  | { kind: "ca-untrusted" }
  | { kind: "operator-auth-failed"; message: string }
  | { kind: "public-ip-unavailable" }
  | { kind: "public-ip-not-confirmed" }
  | { kind: "vendor-auth-failed"; message: string }
  | { kind: "vendor-unreachable" }
  | { kind: "device-approval-timeout" };

/** ベンダーのログイン状態（試験に使う）。資格情報の値は含めない。 */
export interface VendorSessionState {
  readonly vendor: "protonvpn" | "adguardvpn";
  readonly planId: string;
}

/** 準備処理の結果を保持する（プロセス内。ファイルには書かない）。 */
export interface LiveSession {
  readonly api: ApiClient;                                  // 管理者の Cookie を保持する
  readonly baseline: { readonly publicIp: string; readonly measuredAt: string };
  readonly vendor: VendorSessionState;
}

/** 準備処理の結果。失敗時は以降の段を実行しない。 */
export type PrepareOutcome = { ok: true; session: LiveSession } | { ok: false; step: PrepareStep; reason: AbortReason };

/** 端末の入力と表示の依存（テストでは差し替える）。 */
export interface PrepareIo {
  readonly hidden: (label: string) => Promise<string>;   // 非表示の入力（資格情報・2FA）
  readonly visible: (label: string) => Promise<string>;  // 表示する入力（確認の応答のみ）
  readonly print: (message: string) => void;
}

/** 中止の理由を、端末に表示する文言にする（秘密を含まない）。 */
export function describeAbort(reason: AbortReason): string {
  switch (reason.kind) {
    case "api-unreachable":
      return "検証サーバの API に届かない。ネットワークと API の状態を確認する";
    case "ca-untrusted":
      return "API の証明書を取り込んだ CA で検証できない。資格情報は入力していない";
    case "operator-auth-failed":
      return `管理者の認証に失敗した（API: ${reason.message}）`;
    case "public-ip-unavailable":
      return "開発サーバの公開 IP を取得できない";
    case "public-ip-not-confirmed":
      return "開発者が、検証サーバと同じ回線であることを確認しなかった";
    case "vendor-auth-failed":
      return `認証に失敗した（${reason.message}）`;
    case "vendor-unreachable":
      return "接続に失敗した";
    case "device-approval-timeout":
      return "承認の時間切れ（5 分以内に承認されなかった）";
  }
}
