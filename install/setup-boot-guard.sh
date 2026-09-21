#!/bin/sh
# 責務: ホスト起動時、Dockerとproxyコンテナがnftルールを適用するまでの間もKill Switchを効かせるための
# 起動ガード（systemd oneshotユニット）を作成・有効化する。
#
# 背景: `ip_forward=1`（install/setup-sysctl.shで永続化）は起動直後から有効だが、`inet vpngwgui`テーブルは
# Docker→proxy→APIの設定通知を経て初めて作られる。この間、LAN機器の通信がVPNを迂回してリークする
# （実機の再起動検証で確認。wbs/phase3.md「実機検証で発見・修正した不具合」参照）。
# 本ユニットはネットワーク起動前に、proxyが適用するものと同名のテーブルへ「LAN側から入る転送はdrop
# （Docker公開ポート宛のDNATのみ許可）」だけを載せる。proxyは最初の`POST /settings`受信時にこのテーブルを
# 全撤去→再構成（原子的置換）するため、以降は通常のルールに置き換わる（透過ゲートウェイ無効設定なら撤去される）。
#
# 前提: リポジトリルートの`.env`にLAN_IFACEがあること（install/detect-lan-interface.shの出力）。
# 実行方法（対象ホスト上、root権限で）: sudo sh install/setup-boot-guard.sh
# 撤去: systemctl disable --now vpngwgui-boot-guard.service && rm /etc/systemd/system/vpngwgui-boot-guard.service

set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "root権限で実行してください（例: sudo sh $0）" 1>&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ENV_FILE="$SCRIPT_DIR/../.env"
LAN_IFACE=$(grep '^LAN_IFACE=' "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2)
if [ -z "$LAN_IFACE" ]; then
  echo "LAN_IFACEが.envにありません。先にinstall/detect-lan-interface.shを実行してください。" 1>&2
  exit 1
fi
# インターフェース名をユニットファイルへ埋め込むため、不正な文字（インジェクション）を拒否する。
case "$LAN_IFACE" in
  *[!A-Za-z0-9._-]*) echo "不正なインターフェース名です: $LAN_IFACE" 1>&2; exit 1 ;;
esac

UNIT_FILE="/etc/systemd/system/vpngwgui-boot-guard.service"
NFT_BIN=$(command -v nft)

# nftは1回の起動で渡した全コマンドを1トランザクションとして適用する（add→delete→addで既存テーブルの
# 有無に関わらず原子的に置換）。ルール内容はproxy/src/network/ruleset.tsのフェイルクローズ構成の最小版。
cat > "$UNIT_FILE" <<EOU
# vpngateway-gui: 起動直後のKill Switch用フェイルクローズガード。install/setup-boot-guard.shにより作成された。
[Unit]
Description=vpngateway-gui boot-time fail-closed guard
DefaultDependencies=no
Before=network-pre.target docker.service
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$NFT_BIN 'add table inet vpngwgui ; delete table inet vpngwgui ; add table inet vpngwgui ; add chain inet vpngwgui forward { type filter hook forward priority 0 ; policy accept ; } ; add rule inet vpngwgui forward ct status dnat accept ; add rule inet vpngwgui forward iifname "$LAN_IFACE" drop'

[Install]
WantedBy=sysinit.target
EOU

systemctl daemon-reload
systemctl enable vpngwgui-boot-guard.service
# 今すぐ適用すると稼働中のproxyのルールを上書きするため、ここでは起動（start）はしない（次回起動から有効）。

echo "作成しました: $UNIT_FILE（LAN_IFACE=$LAN_IFACE。次回起動から有効）"
