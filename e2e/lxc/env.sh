# 責務: E2E検証環境で共通に使う名前・パス・接続方法の定義。他のスクリプトから`. env.sh`で読み込む。
#
# GW_MODE=lxc（既定）: ゲートウェイ役もLXCコンテナ（開発ホスト上、KVM無し環境向け）。LAN端末役は同じlxdbr0上。
# GW_MODE=ssh        : ゲートウェイ役は実機/実VMへSSH接続（例: 192.168.3.240の検証用Ubuntu）。
#                      LAN端末役は開発ホスト上のmacvlan LXCコンテナ（実LANのIPv4/IPv6アドレスを持つ）。
#                      資材の転送はscp、コマンドは`sudo`付きでssh経由実行する。
# GW_MODE=roles      : デプロイメント構成の分離（3台分離構成、e2e/lxc/setup-roles.shで構築）向け。
#                      web役・api役・gateway役が別々のLXCコンテナ（検証サーバ上）に分かれる。
#                      LAN端末役（role-lanclient）はgateway役をデフォルトゲートウェイとする。
#                      `gw`はgateway役（nft・docker compose exec proxy/runner-*・systemctl等）を指す点は
#                      他モードと同じだが、Web UI（web役）はgateway役と別ホストのため、`WEB_BASE`で
#                      その実際のURLを持つ（`api_role`/`web_role`はapi役・web役へのコマンド実行）。
GW_MODE=${GW_MODE:-lxc}
GW_REPO_DIR=/opt/vpngwgui
BASE_IMAGE=${BASE_IMAGE:-ubuntu:24.04}

if [ "$GW_MODE" = ssh ]; then
  GW_SSH=${GW_SSH:-ubuntu@192.168.3.240}
  GW_LAN_IF=${GW_LAN_IF:-enp6s18}
  CLIENT_NAME=${CLIENT_NAME:-vpngw-lan}
  GW_NAME=${GW_NAME:-remote}
  SSH_OPTS="-o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
elif [ "$GW_MODE" = roles ]; then
  GW_NAME=${GW_NAME:-role-gateway}
  API_NAME=${API_NAME:-role-api}
  WEB_NAME=${WEB_NAME:-role-web}
  CLIENT_NAME=${CLIENT_NAME:-role-lanclient}
  GW_LAN_IF=${GW_LAN_IF:-eth0}
  WEB_PORT=${WEB_PORT:-80}
  # web役コンテナの実際のIPv4アドレスから、Web UI（api経由の制御も含む）のベースURLを組み立てる。
  WEB_IP=$(lxc exec "$WEB_NAME" -- sh -c "ip -4 -o addr show eth0 | awk '{sub(\"/.*\",\"\",\$4); print \$4}'" | head -n1)
  WEB_BASE="https://$WEB_IP:$WEB_PORT"
else
  GW_NAME=${GW_NAME:-vpngw-gw}
  CLIENT_NAME=${CLIENT_NAME:-vpngw-client}
  GW_LAN_IF=${GW_LAN_IF:-eth0}
fi
