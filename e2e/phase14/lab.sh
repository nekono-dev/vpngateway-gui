#!/bin/bash
# 責務: Phase 14（ドメイン迂回とDNS中継）の検証ラボを、検証サーバのLXD上に作る／壊す（冪等）。
# 実行: 検証サーバ（lxcを使えるユーザー）上で `bash e2e/phase14/lab.sh create|destroy|status`。
#
# トポロジ（すべてLXCシステムコンテナ。ホストのlxdbr0はインターネット接続（apt・docker取得）用にルータの片側だけが使う）:
#
#   [client 10.98.1.20]─┐                          ┌─[target 203.0.113.10〜13:8080  接続元IPを返す]
#   [dns    10.98.1.40]─┤ vpngw14-lan  ┌─[router]─┤ vpngw14-inet（NATなし。接続元IPがそのまま見える）
#   [gw     10.98.1.10]─┤ 10.98.1.0/24 │ .1   .1  │
#   [vpnexit10.98.1.30]─┘              └──────────┘
#        gwのeth1(10.99.0.10)──vpngw14-vpn──vpnexitのeth0(10.99.0.30)   ← 「VPNトンネル」の代役（別インターフェース）
#
# 「VPN接続中」は、gwのデフォルトルートを eth1（vpnexit経由）へ張り替えて再現する（scenarios.shのvpn_up/vpn_down）。
# 宛先サーバが見る接続元IPで経路を判別する: VPN経由=vpnexit(10.98.1.30)、迂回（実回線）=gw(10.98.1.10)。

set -eu
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
IMAGE=${IMAGE:-ubuntu:24.04}
LAN=vpngw14-lan
INET=vpngw14-inet
VPN=vpngw14-vpn
CONTAINERS="p14-router p14-gw p14-client p14-vpnexit p14-dns p14-target"

exists() { lxc info "$1" >/dev/null 2>&1; }
# コンテナ内のシェルでコマンドを実行する
in_c() { local c=$1; shift; lxc exec "$c" -- "$@"; }
wait_ready() { in_c "$1" cloud-init status --wait >/dev/null 2>&1 || true; }

# 目的: コンテナのネットワーク設定（netplan）を静的に書く。
# 入力: コンテナ名, 以降はnetplanのethernets配下のYAML断片（インデント済み）
set_netplan() {
  local c=$1 body=$2
  local file; file=$(mktemp)
  printf 'network:\n  version: 2\n  ethernets:\n%s\n' "$body" >"$file"
  in_c "$c" rm -f /etc/netplan/50-cloud-init.yaml
  lxc file push "$file" "$c/etc/netplan/60-p14.yaml" >/dev/null
  in_c "$c" chmod 600 /etc/netplan/60-p14.yaml
  rm -f "$file"
  in_c "$c" netplan apply
}

create_networks() {
  for net in "$LAN" "$INET" "$VPN"; do
    lxc network show "$net" >/dev/null 2>&1 || lxc network create "$net" ipv4.address=none ipv6.address=none
  done
}

launch() { # launch <name> <network> [追加オプション...]
  local name=$1 net=$2; shift 2
  exists "$name" || lxc launch "$IMAGE" "$name" --network "$net" "$@"
}

create() {
  create_networks
  # ルータ: eth0=lxdbr0（インターネット）、eth1=LAN側、eth2=宛先サーバ側
  if ! exists p14-router; then
    lxc launch "$IMAGE" p14-router
    lxc config device add p14-router eth1 nic network="$LAN" name=eth1
    lxc config device add p14-router eth2 nic network="$INET" name=eth2
  fi
  launch p14-gw "$LAN" -c security.nesting=true
  launch p14-client "$LAN"
  launch p14-dns "$LAN"
  launch p14-target "$INET"
  if ! exists p14-vpnexit; then
    lxc launch "$IMAGE" p14-vpnexit --network "$VPN"
    lxc config device add p14-vpnexit eth1 nic network="$LAN" name=eth1
  fi
  if ! lxc config device show p14-gw | grep -q '^eth1:'; then
    lxc config device add p14-gw eth1 nic network="$VPN" name=eth1
  fi
  for c in $CONTAINERS; do wait_ready "$c"; done

  set_netplan p14-router "    eth0: {dhcp4: true}
    eth1: {addresses: [10.98.1.1/24]}
    eth2: {addresses: [203.0.113.1/24]}"
  set_netplan p14-gw "    eth0: {addresses: [10.98.1.10/24], routes: [{to: default, via: 10.98.1.1}], nameservers: {addresses: [1.1.1.1]}}
    eth1: {addresses: [10.99.0.10/24]}"
  set_netplan p14-client "    eth0: {addresses: [10.98.1.20/24], routes: [{to: default, via: 10.98.1.10}], nameservers: {addresses: [1.1.1.1]}}"
  set_netplan p14-dns "    eth0: {addresses: [10.98.1.40/24], routes: [{to: default, via: 10.98.1.1}], nameservers: {addresses: [1.1.1.1]}}"
  set_netplan p14-vpnexit "    eth0: {addresses: [10.99.0.30/24]}
    eth1: {addresses: [10.98.1.30/24], routes: [{to: default, via: 10.98.1.1}], nameservers: {addresses: [1.1.1.1]}}"
  set_netplan p14-target "    eth0: {addresses: [203.0.113.10/24, 203.0.113.11/24, 203.0.113.12/24, 203.0.113.13/24], routes: [{to: default, via: 203.0.113.1}]}"

  # ルータ: 転送＋LAN→インターネットのみNAT（宛先サーバ側へはNATしない）
  in_c p14-router sh -c 'sysctl -qw net.ipv4.ip_forward=1; apt-get -o DPkg::Lock::Timeout=300 install -y -qq nftables >/dev/null
nft -f - <<EOF2
flush ruleset
table ip nat {
  chain post {
    type nat hook postrouting priority 100
    oifname "eth0" ip saddr 10.98.1.0/24 masquerade
  }
}
EOF2'
  # VPN出口: 転送＋LAN側へ出るときにNAT（宛先サーバには10.98.1.30として見える）
  in_c p14-vpnexit sh -c 'sysctl -qw net.ipv4.ip_forward=1; apt-get -o DPkg::Lock::Timeout=300 install -y -qq nftables >/dev/null
nft -f - <<EOF2
flush ruleset
table ip nat {
  chain post {
    type nat hook postrouting priority 100
    oifname "eth1" masquerade
  }
}
EOF2'
  # クライアント: curl・dig
  in_c p14-client sh -c 'export DEBIAN_FRONTEND=noninteractive; apt-get -o DPkg::Lock::Timeout=300 update -qq && apt-get -o DPkg::Lock::Timeout=300 install -y -qq curl dnsutils iproute2 >/dev/null'
  # ゲートウェイ役: 検証用の道具（tcpdump・dig）。docker・nftables等はinstall.shが導入する。
  in_c p14-gw sh -c 'export DEBIAN_FRONTEND=noninteractive; apt-get -o DPkg::Lock::Timeout=300 update -qq && apt-get -o DPkg::Lock::Timeout=300 install -y -qq curl dnsutils tcpdump >/dev/null'

  # 宛先サーバ・モックDNS（自宅DNSサーバの代役）
  lxc file push "$HERE/target-server.py" p14-target/root/target-server.py >/dev/null
  in_c p14-target sh -c 'systemctl stop p14-target 2>/dev/null; systemd-run --unit=p14-target python3 /root/target-server.py 8080 203.0.113.10 203.0.113.11 203.0.113.12 203.0.113.13 >/dev/null'
  local pki; pki=$(mktemp -d)
  openssl req -x509 -newkey rsa:2048 -nodes -days 3 -keyout "$pki/key.pem" -out "$pki/cert.pem" \
    -subj "/CN=dns.lab.test" -addext "subjectAltName=DNS:dns.lab.test,IP:10.98.1.40" 2>/dev/null
  lxc file push "$pki/key.pem" p14-dns/root/key.pem >/dev/null
  lxc file push "$pki/cert.pem" p14-dns/root/cert.pem >/dev/null
  cp "$pki/cert.pem" /tmp/p14-doh-ca.pem
  rm -rf "$pki"
  lxc file push "$HERE/mock-doh.py" p14-dns/root/mock-doh.py >/dev/null
  in_c p14-dns sh -c 'systemctl stop p14-doh 2>/dev/null; systemd-run --unit=p14-doh python3 /root/mock-doh.py 10.98.1.40 /root/cert.pem /root/key.pem >/dev/null'
  echo "ラボを作成した（DoH用のCA証明書: /tmp/p14-doh-ca.pem）"
}

destroy() {
  for c in $CONTAINERS; do exists "$c" && lxc delete -f "$c"; done
  for net in "$LAN" "$INET" "$VPN"; do lxc network show "$net" >/dev/null 2>&1 && lxc network delete "$net"; done
  echo "ラボを削除した"
}

case "${1:-}" in
  create) create ;;
  destroy) destroy ;;
  status) lxc list "p14-" ;;
  *) echo "使い方: $0 create|destroy|status" >&2; exit 2 ;;
esac
