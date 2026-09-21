#!/bin/bash
# 責務: 手元のリポジトリ（node_modules/dist/.git/.envを除く）をゲートウェイ役へ転送し（ssh時はscp）、
# 既定では `docker compose build` と `docker compose up -d` まで実施する。
# 使い方: [GW_MODE=ssh] bash e2e/lxc/sync.sh [--no-build]
# 注意: ゲートウェイ側の`.env`（install/detect-lan-interface.shの出力）は転送対象外（上書きも削除もしない）。
#       それ以外の転送先ファイルは展開前に削除する（手元で削除したファイルを残さないため）。

set -eu
. "$(dirname "$0")/env.sh"
. "$(dirname "$0")/../lib/gw.sh"
REPO_ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
TMP_TGZ=$(mktemp --suffix=.tgz)
trap 'rm -f "$TMP_TGZ"' EXIT

tar --exclude=node_modules --exclude=dist --exclude=dist-server --exclude=.git --exclude=.env -czf "$TMP_TGZ" -C "$REPO_ROOT" .
gw_push "$TMP_TGZ" /root/repo.tgz
# 手元で削除・改名したファイルが転送先に残りビルドを壊さないよう、`.env`以外を消してから展開する
# （Dockerの名前付きボリューム・`.env`は影響を受けない）。
gw sh -c "mkdir -p $GW_REPO_DIR && find $GW_REPO_DIR -mindepth 1 -maxdepth 1 ! -name .env -exec rm -rf {} + && tar -xzf /root/repo.tgz -C $GW_REPO_DIR"

if [ "${1:-}" != "--no-build" ]; then
  # 初回はネットワーク一時失敗で落ちることがあったため1回だけ再試行する
  gw sh -c 'docker compose build >/root/build.log 2>&1 || docker compose build >/root/build.log 2>&1 || { tail -20 /root/build.log; exit 1; }'
  gw docker compose up -d
fi
