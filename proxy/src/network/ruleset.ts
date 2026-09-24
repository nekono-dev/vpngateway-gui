// 責務: 透過ゲートウェイモード・Kill Switchのnftablesルールセット（`nft -f -`へ渡すスクリプト文字列）を
// 組み立てる。proxyserver/design.md「透過ゲートウェイモードの実現方式」「Kill Switch」に対応する。
// nftコマンドを実際に実行する処理（nft-client.ts）とは分離し、本ファイルは純粋な文字列組み立てのみを行う
// （実nftバイナリなしに単体テスト可能にするため）。

import { isValidInterfaceName } from "../lib/interface-name.js";
import { isIpv4Cidr } from "../lib/ipv4-cidr.js";

// ホスト上の既存ルール（ufw等）と衝突・意図せぬ上書きが起きないよう、専用テーブル名で独立管理する
// （proxyserver/design.md「NAT/FORWARDルール」参照）。
export const GATEWAY_TABLE_NAME = "vpngwgui";

// ドメイン迂回（split-tunnel）: 迂回対象のIPv4アドレスを入れるsetの名前、迂回する通信に付けるfwmark、
// 迂回経路（実回線のデフォルトゲートウェイ）を置くルーティングテーブルの番号
// （proxyserver/design.md「ドメイン迂回とDNS中継」の「nft set・ポリシールーティング」）。
export const BYPASS_SET_NAME = "bypass4";
export const BYPASS_FWMARK = 0x100;
export const BYPASS_ROUTE_TABLE = 100;

export interface BypassEntry {
  address: string;
  // setの要素の残り期限（秒）。
  timeoutSeconds: number;
}

export interface BypassRulesetInput {
  // 適用時点でsetへ入れておく要素（再構成で失われないよう、呼び出し元が保持している有効な要素を渡す）。
  entries: readonly BypassEntry[];
  // 明示的プロキシ（3proxy）の実行ユーザーID。指定するとホスト自身の発信（3proxy）も迂回の対象にする。
  explicitProxyUid: number | undefined;
}

export interface DnsRedirectInput {
  // 中継リゾルバの待受アドレス・ポート（DNATの宛先）。
  listenAddress: string;
  port: number;
  // リダイレクトしない宛先のIPv4 CIDR（LAN内のDNSサーバ等）。
  excludedCidrs: readonly string[];
}

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
  // 透過ゲートウェイ（LAN機器の転送・Kill Switch）を構成するか。省略時はtrue。falseの場合は、
  // ドメイン迂回・DNSリダイレクトのための要素のみを含むテーブルを作る（明示的プロキシのみで迂回する場合）。
  transparentGateway?: boolean;
  // ドメイン迂回。省略すると迂回の要素を作らない。
  bypass?: BypassRulesetInput;
  // 宛先ポート53の通信を中継リゾルバへ誘導する。省略するとリダイレクトしない。
  dnsRedirect?: DnsRedirectInput;
}

const IPV4_ADDRESS_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIpv4Address(value: string): boolean {
  const match = IPV4_ADDRESS_PATTERN.exec(value);
  return match !== null && match.slice(1).every((octet) => Number(octet) <= 255);
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
  const { lanIface, wanIface, vpnIface, killSwitch, bypass, dnsRedirect } = input;
  const transparentGateway = input.transparentGateway ?? true;

  // 動的に決まる値（vpnIfaceはip routeの解析結果、lan/wanIfaceは設定ファイル由来）を
  // ルール文字列へ埋め込む前に必ず形式検証する（proxyserver/design.md「実行可能バイナリの許可リストに
  // よる内部防御」と同様、内部コンポーネント間の値であっても外部由来の文字列は信用しない方針）。
  for (const iface of [lanIface, wanIface, vpnIface].filter((v): v is string => v !== undefined)) {
    if (!isValidInterfaceName(iface)) {
      throw new Error(`invalid interface name: ${iface}`);
    }
  }
  // 迂回・リダイレクトの値も、ルール文字列へ埋め込むため検証する。
  for (const entry of bypass?.entries ?? []) {
    if (!isIpv4Address(entry.address) || !Number.isInteger(entry.timeoutSeconds) || entry.timeoutSeconds < 1) {
      throw new Error(`invalid bypass entry: ${JSON.stringify(entry)}`);
    }
  }
  if (bypass?.explicitProxyUid !== undefined && (!Number.isInteger(bypass.explicitProxyUid) || bypass.explicitProxyUid < 0)) {
    throw new Error(`invalid uid: ${bypass.explicitProxyUid}`);
  }
  if (dnsRedirect !== undefined) {
    if (!isIpv4Address(dnsRedirect.listenAddress)) throw new Error(`invalid listen address: ${dnsRedirect.listenAddress}`);
    if (!Number.isInteger(dnsRedirect.port) || dnsRedirect.port < 1 || dnsRedirect.port > 65535) {
      throw new Error(`invalid port: ${dnsRedirect.port}`);
    }
    for (const cidr of dnsRedirect.excludedCidrs) {
      if (!isIpv4Cidr(cidr)) throw new Error(`invalid CIDR: ${JSON.stringify(cidr)}`);
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
  ];
  const rule = (body: string): void => {
    lines.push(`add rule inet ${GATEWAY_TABLE_NAME} ${body}`);
  };

  // natのpostroutingチェーン。透過ゲートウェイ（トンネル・WAN側へのマスカレード）と、ドメイン迂回（実回線側への
  // マスカレード）の両方が使う。
  if (transparentGateway || bypass !== undefined) {
    lines.push(`add chain inet ${GATEWAY_TABLE_NAME} postrouting { type nat hook postrouting priority 100 ; }`);
  }
  if (transparentGateway) {
    lines.push(
      // forwardチェーンは`policy accept`とし、末尾の`iifname "<lan>" drop`で「LAN側インターフェースから入ってきた
      // 転送」だけを遮断対象にする。`policy drop`だと、同居する他のDockerコンテナ等ゲートウェイ機能と無関係な
      // 転送（コンテナのインターネット向け通信）まで巻き込んで遮断してしまうため（実機検証で確認）。
      `add chain inet ${GATEWAY_TABLE_NAME} forward { type filter hook forward priority 0 ; policy accept ; }`,
    );
  }

  if (bypass !== undefined) {
    lines.push(`add set inet ${GATEWAY_TABLE_NAME} ${BYPASS_SET_NAME} { type ipv4_addr ; flags timeout ; }`);
    if (bypass.entries.length > 0) {
      const elements = bypass.entries.map((entry) => `${entry.address} timeout ${entry.timeoutSeconds}s`).join(", ");
      lines.push(`add element inet ${GATEWAY_TABLE_NAME} ${BYPASS_SET_NAME} { ${elements} }`);
    }
    // LAN機器からの通信のうち、宛先が迂回対象のものへfwmarkを付ける（ルーティング判定の前=prerouting・mangle優先度）。
    // 応答方向をforwardで許可できるよう、conntrackにも同じマークを付ける。
    lines.push(`add chain inet ${GATEWAY_TABLE_NAME} bypass_mark { type filter hook prerouting priority -150 ; }`);
    rule(`bypass_mark iifname "${lanIface}" ip daddr @${BYPASS_SET_NAME} meta mark set ${BYPASS_FWMARK} ct mark set ${BYPASS_FWMARK}`);
    if (bypass.explicitProxyUid !== undefined) {
      // ホスト自身の発信（明示的プロキシ）。`type route`はマーク変更後に経路を再評価する。
      lines.push(`add chain inet ${GATEWAY_TABLE_NAME} bypass_mark_output { type route hook output priority -150 ; }`);
      rule(`bypass_mark_output meta skuid ${bypass.explicitProxyUid} ip daddr @${BYPASS_SET_NAME} meta mark set ${BYPASS_FWMARK}`);
    }
    // 迂回する通信を実回線側でマスカレードする。ホスト自身の発信（明示的プロキシ）は、接続時にVPN側の経路で送信元
    // アドレスが選ばれた後にマークで実回線へ経路が変わるため、送信元がVPN側のアドレスのまま出てしまい、応答が戻らない
    // （実機検証で確認）。LAN機器からの転送も同じ規則で、実回線側のアドレスへ揃える。
    rule(`postrouting meta mark ${BYPASS_FWMARK} oifname "${wanIface}" masquerade`);
  }

  if (dnsRedirect !== undefined) {
    // 宛先ポート53のLAN発の通信を、中継リゾルバへ誘導する（手動でDNSを指定した端末も対象にする）。
    // ゲートウェイ自身宛と、利用者が除外したCIDR宛は誘導しない。
    lines.push(`add chain inet ${GATEWAY_TABLE_NAME} dns_redirect { type nat hook prerouting priority -100 ; }`);
    const excluded = [dnsRedirect.listenAddress, ...dnsRedirect.excludedCidrs].join(", ");
    rule(
      `dns_redirect iifname "${lanIface}" meta l4proto { udp, tcp } th dport 53 ip daddr != { ${excluded} } ` +
        `dnat ip to ${dnsRedirect.listenAddress}:${dnsRedirect.port}`,
    );
  }

  if (!transparentGateway) {
    return lines.map((line) => `${line}\n`).join("");
  }

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
  if (bypass !== undefined) {
    // (3) 迂回対象として印を付けた通信は、VPN未接続・Kill Switch ONでも許可する（利用者が迂回を指定した通信であり、
    // 実回線から出る）。単一NICでは応答方向もLAN側インターフェースから入ってくるため、conntrackのマークで双方向を許可する。
    rule(`forward ct mark ${BYPASS_FWMARK} accept`);
  }

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
