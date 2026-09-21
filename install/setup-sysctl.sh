#!/bin/sh
# 責務: ホスト上にIPフォワーディングを永続的に有効化する設定ファイルを1つ作成し、即座に反映する。
# proxyコンテナは`network_mode: host`でホストのネットワーク名前空間を共有するため、この設定は
# ホスト側で一度だけ永続化するのが妥当（proxyserver/design.md「IPフォワーディングの永続化」参照）。
#
# 実行方法（対象ホスト上、root権限で）: sudo sh install/setup-sysctl.sh
#
# 「ホストの変更を最小限に抑える」方針（specs/requirements.md参照）に沿い、作成するファイルは
# 本スクリプトが作成する1ファイルのみとする。

set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "root権限で実行してください（例: sudo sh $0）" 1>&2
  exit 1
fi

SYSCTL_FILE="/etc/sysctl.d/99-vpngwgui.conf"

cat > "$SYSCTL_FILE" <<'EOF'
# vpngateway-gui: LAN機器への透過ゲートウェイ提供に必要なIPフォワーディング設定。
# install/setup-sysctl.shにより作成された。手動で削除・変更しないこと。
net.ipv4.ip_forward=1
EOF

sysctl --system

echo "作成しました: $SYSCTL_FILE"
