# 責務: E2E検証環境で共通に使う名前・パス・接続方法の定義。他のスクリプトから`. env.sh`で読み込む。
#
# GW_MODE=lxc（既定）: ゲートウェイ役もLXCコンテナ（開発ホスト上、KVM無し環境向け）。LAN端末役は同じlxdbr0上。
# GW_MODE=ssh        : ゲートウェイ役は実機/実VMへSSH接続（例: 192.168.3.240の検証用Ubuntu）。
#                      LAN端末役は開発ホスト上のmacvlan LXCコンテナ（実LANのIPv4/IPv6アドレスを持つ）。
#                      資材の転送はscp、コマンドは`sudo`付きでssh経由実行する。
GW_MODE=${GW_MODE:-lxc}
GW_REPO_DIR=/opt/vpngwgui
BASE_IMAGE=${BASE_IMAGE:-ubuntu:24.04}

if [ "$GW_MODE" = ssh ]; then
  GW_SSH=${GW_SSH:-ubuntu@192.168.3.240}
  GW_LAN_IF=${GW_LAN_IF:-enp6s18}
  CLIENT_NAME=${CLIENT_NAME:-vpngw-lan}
  GW_NAME=${GW_NAME:-remote}
  SSH_OPTS="-o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
else
  GW_NAME=${GW_NAME:-vpngw-gw}
  CLIENT_NAME=${CLIENT_NAME:-vpngw-client}
  GW_LAN_IF=${GW_LAN_IF:-eth0}
fi
