#!/bin/sh
# 責務: 本番と同じ単一 NIC の構成を、ブリッジ 1 本とネットワーク名前空間で再現する（要件 5.1・6.1・7.1）。
# topology_up は、ブリッジ e2eseg に lan・isp・vpnexit を接続し、ホストの既定経路を isp へ向ける。
# topology_down は、名前空間・ブリッジ・既定経路を元に戻す。何度呼んでも同じ結果になる（冪等）。
#
# 注意: 既定経路を変えるため、ssh などのホストの通信は、topology_down まで届かなくなる。
#       開発サーバ（devSrv）では実行しない。hosted runner（使い捨て）でだけ実行する。

# 呼び出し側が先に env.sh を読むこと（. e2e/hosted/lib/env.sh）。ここでは読み直さない（source 時の $0 が呼び出し元を指すため）

# 既定経路の退避: 変更の前の既定経路（"via X dev Y ..."）を 1 行で保存する
topology_save_route() {
  mkdir -p "$E2E_WORK_DIR"
  if [ ! -s "$E2E_ROUTE_FILE" ]; then
    sudo ip -4 route show default | head -n 1 | sed 's/^default //' > "$E2E_ROUTE_FILE"
  fi
}

# 既定経路を退避した値へ戻す。退避が無ければ何もしない
topology_restore_route() {
  if [ -s "$E2E_ROUTE_FILE" ]; then
    sudo ip -4 route replace default $(cat "$E2E_ROUTE_FILE")
    rm -f "$E2E_ROUTE_FILE"
  fi
}

# LAN クライアント側でコマンドを実行する（要件 5.1・6.1）
lan_exec() {
  sudo ip netns exec "$E2E_NS_LAN" "$@"
}

# 名前空間にインターフェース（eth0）を作り、アドレスと既定経路を設定する
topology_add_ns() {
  ns="$1"; addr="$2"; gw="$3"
  sudo ip netns add "$ns"
  sudo ip link add "$ns-h" type veth peer name eth0 netns "$ns"
  sudo ip link set "$ns-h" master "$E2E_BRIDGE"
  sudo ip link set "$ns-h" up
  sudo ip -n "$ns" addr add "$addr" dev eth0
  sudo ip -n "$ns" link set eth0 up
  sudo ip -n "$ns" link set lo up
  if [ -n "$gw" ]; then sudo ip -n "$ns" route add default via "$gw"; fi
}

# VPN トンネル（vpn0 ↔ vpnexit の vpn0x）を作る。接続の切り替え（既定経路の移動）はモック CLI が行う
# vpnexit は、トンネルからの通信を ISP 側へ masquerade する（ISP からは 192.168.50.200 に見える）
topology_add_tunnel() {
  sudo ip link add vpn0 type veth peer name vpn0x netns "$E2E_NS_VPNEXIT"
  sudo ip addr add "$E2E_TUN_HOST" dev vpn0
  sudo ip link set vpn0 up
  sudo ip -n "$E2E_NS_VPNEXIT" addr add "$E2E_TUN_EXIT" dev vpn0x
  sudo ip -n "$E2E_NS_VPNEXIT" link set vpn0x up
  sudo ip -n "$E2E_NS_VPNEXIT" route add default via "$E2E_ISP_IP"
  sudo ip netns exec "$E2E_NS_VPNEXIT" nft -f - <<'NFT'
table ip vpnexit {
  chain postrouting {
    type nat hook postrouting priority 100;
    oifname "eth0" masquerade
  }
}
NFT
}

# 構成を作る（冪等。既にあれば作り直す）
topology_up() {
  topology_down
  topology_save_route

  sudo ip link add "$E2E_BRIDGE" type bridge
  sudo ip link set "$E2E_BRIDGE" up
  sudo ip addr add "$E2E_HOST_IP/24" dev "$E2E_BRIDGE"

  topology_add_ns "$E2E_NS_LAN" "$E2E_LAN_IP/24" "$E2E_HOST_IP"
  topology_add_ns "$E2E_NS_ISP" "$E2E_ISP_IP/24" ""
  topology_add_ns "$E2E_NS_VPNEXIT" "$E2E_VPNEXIT_IP/24" ""
  sudo ip netns exec "$E2E_NS_VPNEXIT" sysctl -qw net.ipv4.ip_forward=1
  topology_add_tunnel

  # ランナーの通信（元の回線の送信元アドレス発）は、元の回線の経路表で出す。既定経路を移しても GitHub との接続を保つ
  topology_keep_runner_route

  # ホストの既定経路を ISP（上位ルータ）へ向ける。LAN からの通信は、この経路で ISP に届く
  sudo ip route replace default via "$E2E_ISP_IP" dev "$E2E_BRIDGE"
}

# 元の回線の送信元アドレス発の通信を、元の既定経路（表 $E2E_RUNNER_TABLE）で出す
topology_keep_runner_route() {
  src="$(sed -n 's/.* src \([^ ]*\).*/\1/p' "$E2E_ROUTE_FILE")"
  via="$(sed -n 's/.*via \([^ ]*\).*/\1/p' "$E2E_ROUTE_FILE")"
  dev="$(sed -n 's/.*dev \([^ ]*\).*/\1/p' "$E2E_ROUTE_FILE")"
  if [ -n "$src" ] && [ -n "$via" ] && [ -n "$dev" ]; then
    sudo ip rule add from "$src" lookup "$E2E_RUNNER_TABLE" priority 100
    sudo ip route replace default via "$via" dev "$dev" table "$E2E_RUNNER_TABLE"
  fi
}

# 表 $E2E_RUNNER_TABLE と、その規則を消す（冪等）
topology_drop_runner_route() {
  while sudo ip rule del lookup "$E2E_RUNNER_TABLE" 2>/dev/null; do :; done
  sudo ip route flush table "$E2E_RUNNER_TABLE" 2>/dev/null || true
}

# 構成を壊す（冪等）。既定経路を元に戻し、名前空間とブリッジを削除する
topology_down() {
  topology_drop_runner_route
  topology_restore_route
  for ns in "$E2E_NS_LAN" "$E2E_NS_ISP" "$E2E_NS_VPNEXIT"; do
    sudo ip netns del "$ns" 2>/dev/null || true
  done
  sudo ip link del "$E2E_BRIDGE" 2>/dev/null || true
  sudo ip link del vpn0 2>/dev/null || true
  return 0
}
