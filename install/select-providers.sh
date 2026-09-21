#!/bin/sh
# 責務: 有効にするVPNベンダーを、docker composeが自動読み込みするリポジトリルートの`.env`へ書き出す。
# `VPN_PROVIDERS`（APIの`ENABLED_PROVIDERS`。Web UIの選択肢になる）と、起動するランナーコンテナを選ぶ
# `COMPOSE_PROFILES`の2行を、同じ値で書く（片方だけ書き換えて食い違うのを防ぐため。
# specs/design.md「ベンダーの選択と実行基盤」）。他の設定行（LAN_IFACE等）は保持する。
#
# 使い方（対象ホスト上、リポジトリルートで）: sh install/select-providers.sh adguardvpn protonvpn
#   引数のベンダーID（`api/config/profiles/<ID>.json`のファイル名）を有効にする。引数なしでは何も変更しない。
#   AdGuard VPNのランナーは`profiles`を持たず常に起動する（既定のベンダーのため）。

set -eu

if [ "$#" -eq 0 ]; then
  echo "使い方: sh install/select-providers.sh <ベンダーID>...（例: adguardvpn protonvpn）" 1>&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$REPO_ROOT/.env"

for id in "$@"; do
  # ベンダーIDはプロファイルのファイル名。形式（小文字英字始まりの英数字）と、プロファイルの存在を確認する。
  case "$id" in
    [a-z]*) ;;
    *) echo "不正なベンダーID: $id" 1>&2; exit 1 ;;
  esac
  case "$id" in
    *[!a-z0-9]*) echo "不正なベンダーID: $id" 1>&2; exit 1 ;;
  esac
  if [ ! -f "$REPO_ROOT/api/config/profiles/$id.json" ]; then
    echo "プロファイルがありません: api/config/profiles/$id.json" 1>&2
    exit 1
  fi
done

# カンマ区切りに連結する。
LIST=$(printf '%s,' "$@" | sed 's/,$//')

if [ -f "$ENV_FILE" ]; then
  grep -v -e '^VPN_PROVIDERS=' -e '^COMPOSE_PROFILES=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
  mv "$ENV_FILE.tmp" "$ENV_FILE"
fi
{
  echo "VPN_PROVIDERS=$LIST"
  echo "COMPOSE_PROFILES=$LIST"
} >> "$ENV_FILE"

echo "有効なベンダー: $LIST（$ENV_FILE）。反映: docker compose up -d --build"
