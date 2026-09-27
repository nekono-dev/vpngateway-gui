#!/bin/bash
# 責務: デプロイメント構成の分離（3台分離構成）の検証環境を構築する（冪等）。web役・api役・gateway役の
# 3つのLXCシステムコンテナを作成し、このスクリプトを実行したホスト（オーケストレーター。install.shを
# 実行する側）からSSH鍵認証でアクセスできるよう、各コンテナへオーケストレーターの公開鍵とパスワード無し
# sudoを設定する（install.shの分離構成は、配置先ホストへのSSH/SCPアクセス〔鍵認証〕が前提のため）。
#
# 3役ともDockerを動かすため、security.nesting=trueのLXCシステムコンテナとする（検証ホストにKVM無し）。
# gateway役はさらにnetwork_mode: host・nftables・tunデバイスを使う。web役・api役もDocker自体が
# コンテナ内でnet.ipv4.ip_unprivileged_port_start等のsysctlを操作するためnestingを要する
# （実機で、nesting無しのweb役コンテナが`OCI runtime create failed: ... sysctl ... permission denied`で
# 起動に失敗することを確認した）。
#
# さらに、role-gatewayをデフォルトゲートウェイとするLAN端末役コンテナ（role-lanclient）も作成する。
# 実VPN接続操作（接続・切断・国変更）の検証で、gateway役自身ではなくLAN側から見た出口IP・Kill Switchに
# よる遮断を確認するために使う（e2e/lxc/setup.shのCLIENT_NAMEと同じ考え方）。
#
# 実行: bash e2e/lxc/setup-roles.sh
# 前提: このスクリプトを実行するホスト自身に~/.ssh/id_ed25519（無ければ生成される）があり、
#       同じホスト上でinstall.shのオーケストレーターとして使う想定（検証サーバ192.168.3.240で実行する）。
# 出力: 標準出力へ、3コンテナのLAN側（lxdbr0）IPv4アドレスを`ROLE_IP_<role>=<IP>`の形式で表示する。

set -eu
. "$(dirname "$0")/env.sh"

ROLE_NAMES="role-web role-api role-gateway"
ORCH_USER=$(id -un)

[ -f ~/.ssh/id_ed25519.pub ] || ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519 -q
PUBKEY=$(cat ~/.ssh/id_ed25519.pub)

for name in $ROLE_NAMES; do
  lxc info "$name" >/dev/null 2>&1 || lxc launch "$BASE_IMAGE" "$name" -c security.nesting=true
done

for name in $ROLE_NAMES; do
  lxc exec "$name" -- cloud-init status --wait >/dev/null 2>&1 || true
done

for name in $ROLE_NAMES; do
  lxc exec "$name" -- sh -c 'export DEBIAN_FRONTEND=noninteractive; apt-get -o DPkg::Lock::Timeout=300 update -qq && apt-get -o DPkg::Lock::Timeout=300 install -y -qq docker.io docker-compose-v2 openssh-server sudo curl >/dev/null'
  # オーケストレーターと同じユーザー名でSSHログインできるようにする（install.shはSSH_USER=$(id -un)相当を使う）。
  lxc exec "$name" -- sh -c "id -u $ORCH_USER >/dev/null 2>&1 || useradd -m -s /bin/bash $ORCH_USER"
  lxc exec "$name" -- sh -c "mkdir -p /home/$ORCH_USER/.ssh && chmod 700 /home/$ORCH_USER/.ssh && printf '%s\n' '$PUBKEY' > /home/$ORCH_USER/.ssh/authorized_keys && chmod 600 /home/$ORCH_USER/.ssh/authorized_keys && chown -R $ORCH_USER:$ORCH_USER /home/$ORCH_USER/.ssh"
  lxc exec "$name" -- sh -c "printf '%s ALL=(ALL) NOPASSWD:ALL\n' '$ORCH_USER' > /etc/sudoers.d/90-$ORCH_USER && chmod 440 /etc/sudoers.d/90-$ORCH_USER"
  lxc exec "$name" -- systemctl enable --now ssh >/dev/null 2>&1 || true
done

GATEWAY_IP=""
for name in $ROLE_NAMES; do
  ip=$(lxc exec "$name" -- sh -c "ip -4 -o addr show eth0 | awk '{sub(\"/.*\",\"\",\$4); print \$4}'" | head -n1)
  case "$name" in
    role-web) echo "ROLE_IP_web=$ip" ;;
    role-api) echo "ROLE_IP_api=$ip" ;;
    role-gateway) GATEWAY_IP=$ip; echo "ROLE_IP_gateway=$ip" ;;
  esac
done

# LAN端末役: デフォルトゲートウェイをrole-gatewayへ静的に向ける（DHCP由来の経路は使わない。
# 理由はe2e/lxc/setup.shの同種の設定と同じ）。
lxc info role-lanclient >/dev/null 2>&1 || lxc launch "$BASE_IMAGE" role-lanclient
lxc exec role-lanclient -- cloud-init status --wait >/dev/null 2>&1 || true
lxc exec role-lanclient -- apt-get -o DPkg::Lock::Timeout=300 update -qq
lxc exec role-lanclient -- env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y -qq curl iproute2
lxc exec role-lanclient -- mkdir -p /etc/netplan
lxc exec role-lanclient -- sh -c "printf 'network:\n  version: 2\n  ethernets:\n    eth0:\n      dhcp4: true\n      dhcp4-overrides:\n        use-routes: false\n      routes:\n        - to: default\n          via: $GATEWAY_IP\n' > /etc/netplan/60-client.yaml"
lxc exec role-lanclient -- chmod 600 /etc/netplan/60-client.yaml
lxc exec role-lanclient -- netplan apply
sleep 3
echo "ROLE_LANCLIENT_DEFAULT_ROUTE=$(lxc exec role-lanclient -- ip route show default)"
