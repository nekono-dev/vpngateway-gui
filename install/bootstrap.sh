#!/bin/sh
# 責務: 頒布されるインストーラ（`install.sh`）の雛形。CIが`install/build-bootstrap.sh`で、REF・COMMIT・REPO_URLを埋め込んで作る。
# 動作: git等を導入 → 埋め込まれたコミットのソースを取得先（既定/opt/vpngwgui）へ取得 → 取得したHEADがコミットと一致することを確認 →
#       リポジトリ内の本体インストーラ（install/install.sh）へ、受け取った引数をそのまま渡して実行する。
# 取得するのは、埋め込まれたコミット1つに固定される（ブランチ・タグの付け替えがあっても、このスクリプトと取得するソースは食い違わない）。
# 設計: specs/design.md「インストーラと頒布（Phase 13）」。
#
# 使い方（root権限で）: curl -fsSL <頒布URL>/install.sh | sudo sh -s -- --providers <ID>[,<ID>...]
#   引数は本体インストーラ（install/install.sh --help）へそのまま渡される。
#   環境変数 VPNGW_DIR で取得先を変更できる（既定 /opt/vpngwgui）。既に取得済みなら、同じ手順で更新する（未コミットの変更があれば中止）。

set -eu

REF='@@REF@@'
COMMIT='@@COMMIT@@'
REPO_URL='@@REPO_URL@@'
DIR=${VPNGW_DIR:-/opt/vpngwgui}

log() { printf '==> %s\n' "$*"; }
die() { printf 'エラー: %s\n' "$*" 1>&2; exit 1; }

# 雛形のまま（CIによる置換前）実行された場合は中止する。
case "$COMMIT" in
  @@*) die "この install.sh は雛形です。頒布された install.sh（build-bootstrap.sh で生成）を使ってください" ;;
esac
[ "$(id -u)" -eq 0 ] || die "root権限で実行してください（例: curl -fsSL <URL>/install.sh | sudo sh -s -- --providers <ID>）"

log "vpngateway-gui $REF（$COMMIT）"

# git・CA証明書が無ければ導入する（Debian系のみ対象。本体インストーラが改めてOSを検査する）。
if ! command -v git >/dev/null 2>&1 || [ ! -d /etc/ssl/certs ]; then
  command -v apt-get >/dev/null 2>&1 || die "apt-get が見つかりません。Debian・Raspberry Pi OS・Ubuntu が必要です"
  log "git・ca-certificates を導入"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git ca-certificates >/dev/null
fi

if [ -d "$DIR/.git" ]; then
  # 追跡ファイルの変更が残っていると更新で失われるため中止する（.envなど追跡外のファイルは対象外）。
  if [ -n "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]; then
    die "$DIR に未コミットの変更があります。退避してから再実行してください"
  fi
else
  mkdir -p "$DIR"
  [ -z "$(ls -A "$DIR")" ] || die "$DIR は空ではなく、gitリポジトリでもありません。VPNGW_DIR で別の場所を指定してください"
  git -C "$DIR" -c init.defaultBranch=main init -q
  git -C "$DIR" remote add origin "$REPO_URL"
fi
git -C "$DIR" remote set-url origin "$REPO_URL"

log "ソースを取得: $REPO_URL → $DIR"
git -C "$DIR" fetch -q --depth 1 origin "$COMMIT"
git -C "$DIR" checkout -q --detach FETCH_HEAD
# 取得したソースが、埋め込まれたコミットと一致することを確認する（食い違いがあれば実行しない）。
[ "$(git -C "$DIR" rev-parse HEAD)" = "$COMMIT" ] || die "取得したソースが期待するコミットと一致しません（$COMMIT）"

exec sh "$DIR/install/install.sh" "$@"
