#!/bin/sh
# 責務: ホストのLAN側インターフェース名を検出し、docker composeが自動読み込みするリポジトリルートの
# `.env`ファイルへ`LAN_IFACE=<検出結果>`を書き出す（docker-compose.ymlのproxyサービスで
# `${LAN_IFACE:-}`として参照し、コンテナのLAN_IFACE環境変数に渡す）。
# 検出方法はデフォルトゲートウェイの逆引き（`ip route show default`のdevフィールド）とする
# （proxyserver/design.md「NAT/FORWARDルール」参照）。
#
# 前提: 本スクリプトはVPNベンダーCLIが未接続の状態（＝ホストのデフォルトルートがまだLAN側の
# アップリンクを指している状態）で実行すること。VPN接続中に実行すると、誤ってVPNトンネル
# インターフェース自体を検出してしまう。
#
# 実行方法（対象ホスト上、リポジトリルートで）: sh install/detect-lan-interface.sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$REPO_ROOT/.env"

LAN_IFACE=$(ip route show default | awk '{ for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1) }' | head -n1)

if [ -z "$LAN_IFACE" ]; then
  echo "LAN側インターフェースを検出できませんでした（デフォルトルートが存在しません）。" 1>&2
  exit 1
fi

# 既存の.envファイルの他の設定行は保持したまま、LAN_IFACE行のみを追加・上書きする。
if [ -f "$ENV_FILE" ]; then
  grep -v '^LAN_IFACE=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
  mv "$ENV_FILE.tmp" "$ENV_FILE"
fi
echo "LAN_IFACE=$LAN_IFACE" >> "$ENV_FILE"

echo "検出結果: LAN_IFACE=$LAN_IFACE"
echo "書き出しました: $ENV_FILE"
