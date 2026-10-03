#!/bin/sh
# 責務: 開発ホストの作業ツリーを検証サーバへ転送し、実スタック（インストール先）のコンテナを再ビルド・再起動する。
# 設定: リポジトリ直下の`.env`（雛形は`.env.example`）の VERIFY_HOST・VERIFY_USER・VERIFY_SSH_PASSWORD・VERIFY_INSTALL_DIR。
#       環境変数で同名の値を渡せば`.env`より優先する。
# 使い方: scripts/deploy-verify.sh [composeのサービス名...]   （省略時は全サービスを再ビルドする）
#   例: scripts/deploy-verify.sh web
# 転送物: git管理外の依存物・生成物・`.env`・`.git`・`.claude`を除く作業ツリー。検証サーバの`.env`（インストーラ生成）は上書きしない。
#         削除したファイルは検証サーバ側から消えない（上書き転送のみ）。sysctl等のホスト設定の反映が必要な変更は、
#         インストーラの再実行（install.sh）で行う。

set -eu

root=$(cd "$(dirname "$0")/.." && pwd)

# 環境変数で渡された値を優先して、.envを読み込む。
for key in VERIFY_HOST VERIFY_USER VERIFY_SSH_PASSWORD VERIFY_INSTALL_DIR; do
  eval "if [ \"\${$key+set}\" = set ]; then preset_$key=\"\$$key\"; fi"
done
if [ -f "$root/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$root/.env"
  set +a
fi
for key in VERIFY_HOST VERIFY_USER VERIFY_SSH_PASSWORD VERIFY_INSTALL_DIR; do
  eval "if [ \"\${preset_$key+set}\" = set ]; then $key=\"\$preset_$key\"; fi"
done

: "${VERIFY_HOST:?VERIFY_HOST（検証サーバのIPアドレス）を.envまたは環境変数で指定すること}"
VERIFY_USER=${VERIFY_USER:-ubuntu}
VERIFY_INSTALL_DIR=${VERIFY_INSTALL_DIR:-/opt/vpngwgui}
VERIFY_SSH_PASSWORD=${VERIFY_SSH_PASSWORD:-}

ssh_opts="-o StrictHostKeyChecking=no -o LogLevel=ERROR"
remote() {
  if [ -n "$VERIFY_SSH_PASSWORD" ]; then
    # shellcheck disable=SC2086
    SSHPASS=$VERIFY_SSH_PASSWORD sshpass -e ssh $ssh_opts "$VERIFY_USER@$VERIFY_HOST" "$@"
  else
    # shellcheck disable=SC2086
    ssh $ssh_opts "$VERIFY_USER@$VERIFY_HOST" "$@"
  fi
}

services="$*"

echo "== 転送: $VERIFY_USER@$VERIFY_HOST（~/vpngateway-gui → $VERIFY_INSTALL_DIR）"
tar c -C "$root" \
  --exclude=./node_modules --exclude='*/node_modules' --exclude=./.git --exclude=./.claude \
  --exclude=./.env --exclude=dist --exclude=dist-server --exclude=web/src/generated --exclude=api/openapi.json \
  --exclude='*.tsbuildinfo' . |
  remote "mkdir -p ~/vpngateway-gui && tar x -C ~/vpngateway-gui && sudo tar c -C ~/vpngateway-gui . | sudo tar x --no-same-owner -C '$VERIFY_INSTALL_DIR'"

echo "== 再ビルド・再起動: ${services:-全サービス}"
# shellcheck disable=SC2086
remote "cd '$VERIFY_INSTALL_DIR' && sudo docker compose build $services && sudo docker compose up -d $services && sudo docker compose ps"
echo "== 反映完了"
