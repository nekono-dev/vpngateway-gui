#!/bin/bash
# 責務: 検証環境の構築（冪等）。ゲートウェイ役・LAN端末役のLXCシステムコンテナを作成し、ゲートウェイ側へ
# Docker/nftablesを導入する。リポジトリ転送とdocker compose起動は sync.sh が担う。
#
# 背景: 検証ホストがKVM無し（/dev/kvmが存在しない）のため、LXD「VM」（QEMU）は使えない。そのため
# security.nesting=trueのLXCシステムコンテナを用いる。ゲートウェイ側は独立したネットワーク名前空間を
# 持ち、その中でDocker（network_mode: host）・nftables・tunデバイスを実際に動かせる。
#
# 実行: [GW_MODE=ssh] bash e2e/lxc/setup.sh

set -eu
. "$(dirname "$0")/env.sh"

. "$(dirname "$0")/../lib/gw.sh"

if [ "$GW_MODE" = ssh ]; then
  # 実機ゲートウェイ: LAN端末役は実LANのアドレスを持つmacvlanコンテナ（開発ホストのNIC名は環境変数LAN_PARENTで指定）
  LAN_PARENT=${LAN_PARENT:-enp6s18}
  if ! lxc profile show macvlan-lan >/dev/null 2>&1; then
    lxc profile create macvlan-lan
    lxc profile device add macvlan-lan eth0 nic nictype=macvlan parent="$LAN_PARENT"
    lxc profile device add macvlan-lan root disk path=/ pool=default
  fi
  lxc info "$CLIENT_NAME" >/dev/null 2>&1 || lxc launch "$BASE_IMAGE" "$CLIENT_NAME" -p macvlan-lan
else
  lxc info "$GW_NAME" >/dev/null 2>&1 || lxc launch "$BASE_IMAGE" "$GW_NAME" -c security.nesting=true
  lxc info "$CLIENT_NAME" >/dev/null 2>&1 || lxc launch "$BASE_IMAGE" "$CLIENT_NAME"
fi

# cloud-initやネットワーク確立を待つ
for name in "$CLIENT_NAME" $([ "$GW_MODE" = ssh ] || echo "$GW_NAME"); do
  lxc exec "$name" -- cloud-init status --wait >/dev/null 2>&1 || true
done

gw sh -c 'export DEBIAN_FRONTEND=noninteractive; apt-get -o DPkg::Lock::Timeout=300 update -qq && apt-get -o DPkg::Lock::Timeout=300 install -y -qq docker.io docker-compose-v2 nftables iproute2 curl sudo >/dev/null'
lxc exec "$CLIENT_NAME" -- sh -c 'export DEBIAN_FRONTEND=noninteractive; apt-get -o DPkg::Lock::Timeout=300 update -qq && apt-get -o DPkg::Lock::Timeout=300 install -y -qq curl iproute2 traceroute >/dev/null'

GW_IP=$(gw_lan_ip)
echo "GW_IP=$GW_IP"

# LAN端末役のデフォルトゲートウェイをゲートウェイ役に向ける。
# DHCPのリース更新のたびにlxdbr0側のデフォルトルートが再追加され、GWを迂回した経路で検証が
# 進んでしまう（結果が無効になる）ため、DHCPのゲートウェイ取得を無効化し、静的にGWを向ける。
lxc exec "$CLIENT_NAME" -- sh -c "
mkdir -p /etc/netplan
cat > /etc/netplan/60-vpngw-client.yaml <<EOF2
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true
      dhcp4-overrides:
        use-routes: false
      routes:
        - to: default
          via: $GW_IP
EOF2
chmod 600 /etc/netplan/60-vpngw-client.yaml
netplan apply
sleep 3
ip route show default
"
