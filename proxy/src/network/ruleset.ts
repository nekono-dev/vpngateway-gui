// 責務: 透過ゲートウェイモード・Kill Switchのnftablesルールセット（`nft -f -`へ渡すスクリプト文字列）を
// 組み立てる。proxyserver/design.md「透過ゲートウェイモードの実現方式」「Kill Switch」に対応する。
// nftコマンドを実際に実行する処理（nft-client.ts）とは分離し、本ファイルは純粋な文字列組み立てのみを行う
// （実nftバイナリなしに単体テスト可能にするため）。

import { isValidInterfaceName } from "../lib/interface-name.js";

// ホスト上の既存ルール（ufw等）と衝突・意図せぬ上書きが起きないよう、専用テーブル名で独立管理する
// （proxyserver/design.md「NAT/FORWARDルール」参照）。
export const GATEWAY_TABLE_NAME = "vpngwgui";

export interface GatewayRulesetInput {
  // LAN側インターフェース名（インストールスクリプトが検出しnetwork.env経由で渡す）。
  lanIface: string;
  // フェイルオープン時（killSwitch=false かつ VPN未接続時）に直接インターネットへ抜けるための
  // 送出インターフェース名。単一NIC構成（対象ターゲットのRaspberry Pi等）ではlanIfaceと同一になりうる
  // （proxyserver/design.md「明示的プロキシモードの実現方式」の単一ホスト構成前提を参照）。
  wanIface: string;
  // VPN接続中のトンネルインターフェース名。未接続時はundefined。
  vpnIface: string | undefined;
  // ユーザ向け設定`killSwitch`の現在値。
  killSwitch: boolean;
}

/**
 * 目的: `inet vpngwgui`テーブルを撤去するnftスクリプトを組み立てる。
 * 入力: なし。
 * 出力: nftスクリプト文字列。テーブルが存在しない場合にnftがエラー終了しても
 *      （`nft-client.ts`側で無視する前提のため）実害はない。
 * 例: buildTeardownScript() // => "delete table inet vpngwgui\n"
 */
export function buildTeardownScript(): string {
  return `delete table inet ${GATEWAY_TABLE_NAME}\n`;
}

/**
 * 目的: 現在の設定・VPN接続状態から、透過ゲートウェイ＋Kill Switchを実現するnftルールセット全体を
 *      組み立てる。`nft -f -`へそのまま渡せる形式。
 * 入力: input(lanIface/wanIface/vpnIface/killSwitch)。
 * 出力: nftスクリプト文字列。
 * 失敗時の方針: lanIface/wanIface/vpnIfaceがLinuxインターフェース名として不正な形式の場合は例外を投げる
 *              （ルール文字列への不正な埋め込み＝インジェクションを防ぐため。呼び出し元でログに残し、
 *              安全側としてルール適用自体を諦める）。
 * 例: buildGatewayRuleset({ lanIface: "eth0", wanIface: "eth0", vpnIface: "tun0", killSwitch: true })
 */
export function buildGatewayRuleset(input: GatewayRulesetInput): string {
  const { lanIface, wanIface, vpnIface, killSwitch } = input;

  // 動的に決まる値（vpnIfaceはip routeの解析結果、lan/wanIfaceは設定ファイル由来）を
  // ルール文字列へ埋め込む前に必ず形式検証する（proxyserver/design.md「実行可能バイナリの許可リストに
  // よる内部防御」と同様、内部コンポーネント間の値であっても外部由来の文字列は信用しない方針）。
  for (const iface of [lanIface, wanIface, vpnIface].filter((v): v is string => v !== undefined)) {
    if (!isValidInterfaceName(iface)) {
      throw new Error(`invalid interface name: ${iface}`);
    }
  }

  const lines: string[] = [
    // `nft -f`は全体を1トランザクションで適用する。「add（無ければ作成）→delete→add」の順にすることで、
    // 既存テーブルの有無に関わらずエラーにならず、旧ルールの撤去と新ルールの適用が原子的に行われる。
    // 撤去と適用を別々のnft呼び出しにすると、その間フィルタが存在しない一瞬にLAN機器の通信が
    // 漏れうる（設定の定期再通知で10秒ごとに再構成されるため、この窓を排除する）。
    `add table inet ${GATEWAY_TABLE_NAME}`,
    `delete table inet ${GATEWAY_TABLE_NAME}`,
    `add table inet ${GATEWAY_TABLE_NAME}`,
    `add chain inet ${GATEWAY_TABLE_NAME} postrouting { type nat hook postrouting priority 100 ; }`,
    // forwardチェーンは`policy accept`とし、末尾の`iifname "<lan>" drop`で「LAN側インターフェースから入ってきた
    // 転送」だけを遮断対象にする。`policy drop`だと、同居する他のDockerコンテナ等ゲートウェイ機能と無関係な
    // 転送（コンテナのインターネット向け通信）まで巻き込んで遮断してしまうため（実機検証で確認）。
    `add chain inet ${GATEWAY_TABLE_NAME} forward { type filter hook forward priority 0 ; policy accept ; }`,
  ];
  const rule = (body: string): void => {
    lines.push(`add rule inet ${GATEWAY_TABLE_NAME} ${body}`);
  };

  // (1) Dockerの公開ポート（web UIの8080等）宛の転送はDNAT済みのconntrackエントリを持つ。LAN側からこの経路で
  // 到達するWeb UIまでもが遮断されると、透過ゲートウェイ有効化後にWeb UIから設定を戻せなくなるため、
  // `ct status dnat`（DNAT済みの接続とその応答）は常に許可する。LAN機器がゲートウェイとして転送させる
  // 通信はDNATされないため、Kill Switchの遮断範囲には影響しない（実機検証で発覚）。
  rule("forward ct status dnat accept");
  // (2) LAN側以外へ向かう「応答方向」の確立済み通信を許可する。単一NIC構成では、同居コンテナ自身の
  // インターネット向け通信の応答パケットもLAN側インターフェースから入ってくる（宛先はコンテナ側ブリッジ）ため、
  // 末尾の遮断に巻き込まれないようにする。`ct direction reply`により、LAN機器発の確立済み通信（オリジナル
  // 方向）はここでは許可されない（KS ON切替後に旧接続が漏れ続けるのを防ぐ）。
  rule(`forward oifname != "${lanIface}" ct direction reply ct state established,related accept`);

  if (vpnIface !== undefined) {
    // VPN接続中: トンネル経由の転送のみを許可する（フェイルクローズ・フェイルオープン共通の経路）。
    rule(`postrouting oifname "${vpnIface}" masquerade`);
    rule(`forward iifname "${lanIface}" oifname "${vpnIface}" accept`);
    rule(`forward iifname "${vpnIface}" oifname "${lanIface}" ct state established,related accept`);
    // トンネル側から入ってくる確立済み応答以外（VPN側からのLAN機器宛の新規接続）は許可しない。
    rule(`forward iifname "${vpnIface}" drop`);
  } else if (!killSwitch) {
    // VPN未接続 かつ killSwitch=false: フェイルオープン。WAN側インターフェースへ直接転送する
    // （proxyserver/design.md「Kill Switch」参照）。
    rule(`postrouting oifname "${wanIface}" masquerade`);
    rule(`forward iifname "${lanIface}" oifname "${wanIface}" accept`);
    rule(`forward iifname "${wanIface}" oifname "${lanIface}" ct state established,related accept`);
  }
  // 上記のいずれにも該当しなかったLAN側からの転送を遮断する。VPN未接続かつkillSwitch=trueの場合は
  // ここまでLAN機器向けのacceptが一つも無いため、LAN機器の通信は全て遮断される（フェイルクローズ）。
  rule(`forward iifname "${lanIface}" drop`);

  return lines.map((line) => `${line}\n`).join("");
}
