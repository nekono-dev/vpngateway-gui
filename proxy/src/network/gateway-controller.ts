// 責務: 透過ゲートウェイモード・Kill Switchの現在状態（ユーザ向け設定＋VPN接続インターフェース）を保持し、
// 状態変化のたびにnftablesルールセットを再構成する（撤去→再適用）。
// ルール文字列の組み立て（ruleset.ts）・nftコマンド実行（nft-client.ts）とは責務を分離し、
// 本ファイルは「いつ・どの状態で再構成するか」の調停のみを行う。

import { runNftScript, type NftResult } from "./nft-client.js";
import { buildGatewayRuleset, buildTeardownScript } from "./ruleset.js";

export interface GatewaySettings {
  transparentGatewayEnabled: boolean;
  killSwitch: boolean;
}

export interface ReconcileOutcome {
  applied: boolean;
  vpnIface: string | undefined;
  // 今回nftルールの再構成を実際に行ったか（設定・VPN接続状態が前回適用時と同じでスキップした場合はfalse）。
  reconciled: boolean;
  // transparentGatewayEnabled=falseの場合、または`lanIface`未設定の場合は撤去のみ行うためundefined。
  teardown: NftResult | undefined;
  // transparentGatewayEnabled=falseの場合、または`lanIface`未設定の場合はapply自体を行わないためundefined。
  apply: NftResult | undefined;
}

// `GET /status`が返す稼働状況（apiserver/design.md「稼働状況取得」と同形状）。
export interface GatewayStatus {
  // active: nftルール適用中 / stopped: 透過ゲートウェイ無効 / unconfigured: 有効設定だがLAN_IFACE未設定 /
  // error: 有効設定だが直近のnft適用が失敗（ルールの実態が不明）。
  state: "active" | "stopped" | "unconfigured" | "error";
  // 検出中のVPNトンネルIF名。未接続時は省略。
  vpnInterface?: string;
  // フェイルオープン中（透過ゲートウェイ適用中・VPN未接続・killSwitch=false）に実際にパケットを
  // 送出しているWAN側インターフェース名。それ以外（VPN接続中、killSwitchによる遮断中など）は省略。
  wanInterface?: string;
  // Kill Switchによりforwardが遮断中（透過ゲートウェイ適用中・VPN未接続・killSwitch=true）か。
  killSwitchBlocking: boolean;
}

const DEFAULT_SETTINGS: GatewaySettings = { transparentGatewayEnabled: false, killSwitch: true };

export class GatewayController {
  private settings: GatewaySettings = DEFAULT_SETTINGS;
  private vpnIface: string | undefined;
  // reconcile()の呼び出しはHTTPハンドラ（/settings受信時）・監視ループ（接続状態ポーリング）・
  // コマンド実行後（/exec完了時）の複数経路から非同期に発生しうるため、nft操作の直列化に用いる。
  private queue: Promise<ReconcileOutcome> = Promise.resolve({
    applied: false,
    vpnIface: undefined,
    reconciled: false,
    teardown: undefined,
    apply: undefined,
  });
  // 直近のnft操作が成功したか。失敗していれば、設定が同じでも次回の通知で再試行する。
  private lastReconcileSucceeded = false;
  // 一度でも再構成を行ったか（プロセス起動直後は既存ルールの実態が不明なため、必ず1回は再構成する）。
  private hasReconciled = false;

  /**
   * 入力: lanIface(LAN側インターフェース名。未設定＝インストールスクリプト未実行環境),
   *      wanIface(フェイルオープン時の送出インターフェース名。省略時はlanIfaceを用いる),
   *      runNft(nftスクリプト実行関数。省略時は実際に`nft`コマンドを実行するnft-client.tsの実装。
   *      単体テストで実nftバイナリなしに差し替えるためのテスト用フック)。
   */
  constructor(
    private readonly lanIface: string | undefined,
    private readonly wanIface: string | undefined = lanIface,
    private readonly runNft: (script: string) => Promise<NftResult> = runNftScript,
  ) {}

  /**
   * 目的: ユーザ向け設定（killSwitch/transparentGatewayEnabled）の最新値を反映し、nftルールを再構成する。
   * 入力: settings(APIサーバから`POST /settings`で通知された最新のユーザ向け設定の一部)。
   * 出力: 再構成結果。
   * 例: await controller.applySettings({ transparentGatewayEnabled: true, killSwitch: true })
   */
  applySettings(settings: GatewaySettings): Promise<ReconcileOutcome> {
    // APIサーバは設定を定期的に再通知する（api/src/server.ts）。前回成功した適用と同じ内容であれば、
    // nftルールを触らず（不要な再構成を避け）前回の結果を返す。プロセス起動後の最初の通知は必ず適用する。
    const unchanged =
      this.hasReconciled &&
      this.lastReconcileSucceeded &&
      settings.killSwitch === this.settings.killSwitch &&
      settings.transparentGatewayEnabled === this.settings.transparentGatewayEnabled;
    this.settings = settings;
    if (unchanged) {
      return this.queue.then((outcome) => ({ ...outcome, reconciled: false }));
    }
    return this.reconcile();
  }

  /**
   * 目的: 現在のVPN接続インターフェース名（未接続ならundefined）を更新し、変化していればnftルールを
   *      再構成する。再接続・国変更・切断検知のいずれの経路からも呼び出せる共通の入り口。
   * 入力: vpnIface(`tunnel-interface.ts`の`getEgressInterface()`が返す値)。
   * 出力: 再構成結果。変化がなければ何もせず前回の結果をそのまま返す。
   * 例: await controller.updateVpnInterface("tun0")
   */
  updateVpnInterface(vpnIface: string | undefined): Promise<ReconcileOutcome> {
    if (vpnIface === this.vpnIface) {
      return this.queue;
    }
    this.vpnIface = vpnIface;
    return this.reconcile();
  }

  /**
   * 目的: メモリ上の現在状態から稼働状況を導出する（`GET /status`用）。nft/ipコマンドは実行しない
   *      ため、値は「最後に適用を試みた結果」であり、外部からの手動変更は検知しない。
   * 入力: なし。
   * 出力: GatewayStatus。プロセス起動直後（設定未受信）は設定の既定値（無効）に基づき"stopped"を返す。
   * 例: controller.getStatus() // => { state: "active", vpnInterface: "tun0", killSwitchBlocking: false }
   */
  getStatus(): GatewayStatus {
    const vpnInterface = this.vpnIface !== undefined ? { vpnInterface: this.vpnIface } : {};
    if (!this.settings.transparentGatewayEnabled) {
      return { state: "stopped", ...vpnInterface, killSwitchBlocking: false };
    }
    if (this.lanIface === undefined) {
      return { state: "unconfigured", ...vpnInterface, killSwitchBlocking: false };
    }
    // 有効設定でも、再構成が未完了（起動直後・実行中）または直近の適用が失敗した間はルールの実態が
    // 不明なため"active"と断定しない。
    if (!this.lastReconcileSucceeded) {
      return { state: "error", ...vpnInterface, killSwitchBlocking: false };
    }
    const killSwitchBlocking = this.settings.killSwitch && this.vpnIface === undefined;
    // フェイルオープン中（VPN未接続・killSwitch=false）のみ、実際に送出に使われるWAN側IF名を返す。
    // VPN接続中やkillSwitchによる遮断中は`wanIface`が実際の転送経路に使われていないため含めない
    // （ruleset.ts参照）。
    const wanInterface =
      this.vpnIface === undefined && !this.settings.killSwitch && this.wanIface !== undefined
        ? { wanInterface: this.wanIface }
        : {};
    return {
      state: "active",
      ...vpnInterface,
      ...wanInterface,
      killSwitchBlocking,
    };
  }

  private reconcile(): Promise<ReconcileOutcome> {
    this.hasReconciled = true;
    this.queue = this.queue.then(() => this.applyCurrentState());
    return this.queue;
  }

  private async applyCurrentState(): Promise<ReconcileOutcome> {
    if (!this.settings.transparentGatewayEnabled || this.lanIface === undefined) {
      // 透過ゲートウェイ無効、またはインストールスクリプト未実行等でLAN側インターフェースが不明な場合は、
      // 安全に構成できない（誤ったインターフェースでの転送を避ける）ため撤去のみで終える。
      // テーブルが存在しない場合nftはエラー終了しうるが、撤去が目的のため結果は無視する。
      const teardown = await this.runNft(buildTeardownScript());
      this.lastReconcileSucceeded = true;
      return { applied: false, vpnIface: this.vpnIface, reconciled: true, teardown, apply: undefined };
    }

    // 再接続・国変更・設定変更のいずれでも、旧ルールが残ったまま新ルールが重複しないよう、毎回テーブル全体を
    // 組み立て直す（proxyserver/design.md「再接続・国変更時の旧ルール撤去→新IFでの再適用処理」）。
    // 撤去と適用は1回のnft呼び出し内の原子的な置換（ruleset.ts参照）で行い、フィルタ不在の瞬間を作らない。
    const script = buildGatewayRuleset({
      lanIface: this.lanIface,
      wanIface: this.wanIface ?? this.lanIface,
      vpnIface: this.vpnIface,
      killSwitch: this.settings.killSwitch,
    });
    const apply = await this.runNft(script);
    this.lastReconcileSucceeded = apply.exitCode === 0;
    return {
      applied: apply.exitCode === 0,
      vpnIface: this.vpnIface,
      reconciled: true,
      teardown: undefined,
      apply,
    };
  }
}
