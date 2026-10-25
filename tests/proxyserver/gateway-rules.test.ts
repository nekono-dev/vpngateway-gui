// 責務: 透過ゲートウェイとKill Switchのnftablesルールセットの受け入れテスト。
// 受け入れ条件 proxyserver/AC-1・AC-2・AC-17 を、ルールセットを組み立てる関数の出力で確認する。

import { describe, expect, it } from "vitest";
import { buildGatewayRuleset } from "../../proxy/src/network/ruleset.js";

const base = { lanIface: "eth0", wanIface: "eth1", killSwitch: true };

/** 目的: スクリプトから、forwardチェーンの規則（本文のみ）を順に取り出す。 */
function forwardRules(script: string): string[] {
  return script
    .split("\n")
    .filter((line) => line.startsWith("add rule inet vpngwgui forward "))
    .map((line) => line.replace("add rule inet vpngwgui forward ", ""));
}

describe("透過ゲートウェイのルールセット", () => {
  it("proxyserver/AC-1: VPNの接続中のルールが、トンネルへのアドレス変換と、LANからトンネルへの転送の許可を含む", () => {
    const script = buildGatewayRuleset({ ...base, vpnIface: "tun0" });
    expect(script).toContain('add rule inet vpngwgui postrouting oifname "tun0" masquerade');
    expect(forwardRules(script)).toContain('iifname "eth0" oifname "tun0" accept');
    // トンネル側から入る新規接続は遮断し、確立済みの応答だけを許可する。
    expect(forwardRules(script)).toContain('iifname "tun0" oifname "eth0" ct state established,related accept');
    expect(forwardRules(script)).toContain('iifname "tun0" drop');
  });

  it("proxyserver/AC-2: Kill Switchの有効かつ未接続のとき、LAN発を遮断する規則が末尾にあり、無効のとき実回線への許可がある", () => {
    const closed = forwardRules(buildGatewayRuleset({ ...base, vpnIface: undefined, killSwitch: true }));
    expect(closed.at(-1)).toBe('iifname "eth0" drop');
    expect(closed.some((rule) => rule.startsWith('iifname "eth0" oifname'))).toBe(false);

    const open = buildGatewayRuleset({ ...base, vpnIface: undefined, killSwitch: false });
    expect(forwardRules(open)).toContain('iifname "eth0" oifname "eth1" accept');
    expect(open).toContain('add rule inet vpngwgui postrouting oifname "eth1" masquerade');
    // フェイルオープンでも、遮断の規則は末尾に残る。
    expect(forwardRules(open).at(-1)).toBe('iifname "eth0" drop');
    // 遮断の対象はLAN側から入る転送だけで、チェーンの既定は許可である。
    expect(open).toContain("policy accept");
  });

  it("proxyserver/AC-17: ルールセットは1つのスクリプトで、作成、削除、作成の順に始まる", () => {
    const script = buildGatewayRuleset({ ...base, vpnIface: "tun0" });
    const lines = script.split("\n").filter(Boolean);
    expect(lines.slice(0, 3)).toEqual([
      "add table inet vpngwgui",
      "delete table inet vpngwgui",
      "add table inet vpngwgui",
    ]);
    // 撤去と適用を分けると無防備な時間ができるため、テーブルの削除は先頭の1回だけである。
    expect(lines.filter((line) => line.startsWith("delete table"))).toHaveLength(1);
  });

  it("不正なインターフェース名は、規則へ埋め込まず例外にする", () => {
    expect(() => buildGatewayRuleset({ ...base, vpnIface: 'tun0" drop #' })).toThrow();
  });
});
