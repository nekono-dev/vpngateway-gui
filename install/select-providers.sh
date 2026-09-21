#!/bin/sh
# 責務: 有効にするVPNベンダーを、docker composeが自動読み込みするリポジトリルートの`.env`へ書き出す。
# `VPN_PROVIDERS`（APIの`ENABLED_PROVIDERS`。Web UIの選択肢になる）と、有効なベンダーのバンドルのcompose fragmentを
# docker-compose.ymlの後ろに並べた`COMPOSE_FILE`の2行を、同じ値から書く（片方だけ書き換えて食い違うのを防ぐため。
# specs/design.md「ベンダー非依存の設計原則」）。他の設定行（LAN_IFACE等）は保持する。
# 暫定: Phase 13で`install/install.sh`へ統合して削除する。
#
# 使い方（対象ホスト上、リポジトリルートで）: sh install/select-providers.sh <ベンダーID>...
#   引数のベンダーID（`vendors/<ID>/`のディレクトリ名）を有効にする。引数なしでは何も変更しない（既定のベンダーは無い）。

set -eu

if [ "$#" -eq 0 ]; then
  echo "使い方: sh install/select-providers.sh <ベンダーID>...（vendors/ にあるベンダーのディレクトリ名）" 1>&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$REPO_ROOT/.env"

FILES="docker-compose.yml"
for id in "$@"; do
  # ベンダーIDはバンドルのディレクトリ名。形式（小文字英字始まりの英数字）と、バンドルの存在を確認する。
  case "$id" in
    [a-z]*) ;;
    *) echo "不正なベンダーID: $id" 1>&2; exit 1 ;;
  esac
  case "$id" in
    *[!a-z0-9]*) echo "不正なベンダーID: $id" 1>&2; exit 1 ;;
  esac
  if [ ! -f "$REPO_ROOT/vendors/$id/profile.json" ] || [ ! -f "$REPO_ROOT/vendors/$id/compose.yml" ]; then
    echo "ベンダーバンドルがありません（profile.json・compose.yml が必要です）: vendors/$id/" 1>&2
    exit 1
  fi
  FILES="$FILES:vendors/$id/compose.yml"
done

# カンマ区切りに連結する。
LIST=$(printf '%s,' "$@" | sed 's/,$//')

if [ -f "$ENV_FILE" ]; then
  grep -v -e '^VPN_PROVIDERS=' -e '^COMPOSE_FILE=' -e '^COMPOSE_PROFILES=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
  mv "$ENV_FILE.tmp" "$ENV_FILE"
fi
{
  echo "VPN_PROVIDERS=$LIST"
  echo "COMPOSE_FILE=$FILES"
} >> "$ENV_FILE"

echo "有効なベンダー: $LIST（$ENV_FILE）。反映: docker compose up -d --build --remove-orphans"
