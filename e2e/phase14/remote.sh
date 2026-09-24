#!/bin/bash
# 責務: 開発ホストから、検証サーバ（GW_SSH。既定 ubuntu@192.168.3.240）上のPhase 14検証ラボ（lab.sh）へ、資材を転送して操作する。
# 使い方:
#   bash e2e/phase14/remote.sh sync           資材を検証サーバへ転送し、ラボのゲートウェイ役（p14-gw）へ反映してビルド・再起動する
#   bash e2e/phase14/remote.sh run [シナリオ...]  検証サーバ上でscenarios.shを実行する（例: run A B）
#   bash e2e/phase14/remote.sh lab create|destroy|status
# 認証: sshpassで検証環境のパスワード（~/.claude/CLAUDE.mdの検証環境の記載）を使う。
set -eu
REPO_ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
SERVER=${GW_SSH:-ubuntu@192.168.3.240}
SSH_OPTS="-o StrictHostKeyChecking=no -o LogLevel=ERROR"
srv() { sshpass -p "${GW_PASSWORD:-ubuntu}" ssh $SSH_OPTS "$SERVER" "$@"; }

case "${1:-}" in
  sync)
    TGZ=$(mktemp --suffix=.tgz)
    tar --exclude=node_modules --exclude=dist --exclude=dist-server --exclude=.git --exclude=.env --exclude=generated -czf "$TGZ" -C "$REPO_ROOT" .
    sshpass -p "${GW_PASSWORD:-ubuntu}" scp $SSH_OPTS -q "$TGZ" "$SERVER:/tmp/repo14.tgz"
    rm -f "$TGZ"
    srv 'rm -rf ~/p14 && mkdir ~/p14 && tar -xzf /tmp/repo14.tgz -C ~/p14
      lxc file push /tmp/repo14.tgz p14-gw/root/repo.tgz >/dev/null
      lxc exec p14-gw -- sh -c "cd /opt/vpngwgui && find . -mindepth 1 -maxdepth 1 ! -name .env -exec rm -rf {} + && tar -xzf /root/repo.tgz -C /opt/vpngwgui && (docker compose build >/root/build.log 2>&1 || docker compose build >/root/build.log 2>&1 || { tail -20 /root/build.log; exit 1; }) && docker compose up -d"'
    ;;
  run) shift; srv "cd ~/p14 && bash e2e/phase14/scenarios.sh $*" ;;
  lab) shift; srv "cd ~/p14 && bash e2e/phase14/lab.sh $*" ;;
  *) echo "使い方: $0 sync|run [シナリオ...]|lab create|destroy|status" >&2; exit 2 ;;
esac
