#!/bin/bash
# 責務: Phase 20完了基準（wbs/phase20.md）を、LXCのクリーンなコンテナで自動検証する。
#       頒布URLと同じ経路（ブートストラップの標準入力パイプ）で --uninstall を実行し、
#       ①取得先ディレクトリ（/opt/vpngwgui）自体が削除されること、②docker composeスタック・sysctl設定・
#       起動時ガードが後始末されること、③同じ頒布URLで再インストールできることを確認する。実VPNは使わない。
# 実行: bash e2e/phase20/uninstall-scenarios.sh [イメージ（既定 ubuntu:24.04）]
# 前提: 検証ホストにLXD（lxc）・git。検証対象のコミットは**コミット済み**であること（ブートストラップはコミットを固定して取得するため）。
#       取得元（REPO_URL）は、開発ホストのリポジトリから作った裸リポジトリをコンテナ内 /srv/vpngw.git に置き、file://で指す
#       （e2e/phase11/install-scenarios.shと同じ方式。GitHubへのpushやReleaseは使わない）。
# 出力: 各検証をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
ROOT=$(CDPATH='' cd -- "$HERE/../.." && pwd)
IMAGE=${1:-ubuntu:24.04}
NAME=${E2E_CONTAINER:-vpngw-uninst}
WORK=$(mktemp -d)
FAILS=0
DIR=/opt/vpngwgui

check() { # check <説明> <条件が真のときexit 0となる関数・コマンド...>
  local desc=$1; shift
  if "$@"; then echo "PASS: $desc"; else echo "FAIL: $desc"; FAILS=$((FAILS+1)); fi
}
ct() { lxc exec "$NAME" -- "$@"; }
sh_ct() { lxc exec "$NAME" -- sh -c "$1"; }
run_bootstrap() { local f=$1; shift; lxc exec "$NAME" -- sh -s -- "$@" < "$f"; }
WEB_COOKIE=/tmp/e2e-cookie.txt
# Phase25でAPIが認証必須になったため、E2E共通アカウント（初回のみ作成）でログインしてから叩く。
# 導入・再導入のたびapiコンテナが（再）作成されセッション（プロセスメモリ）がリセットされるため、
# web_ok()を呼ぶ前に毎回ログインし直す。
# Phase25 Stage3でwebサーバが自己署名証明書のHTTPSになったため、-k（証明書検証省略）を付ける。
web_login() { ct sh -c "curl -sk -c $WEB_COOKIE -X POST -H 'content-type: application/json' -d '{\"username\":\"e2e-admin\",\"password\":\"e2e-password-1234\"}' https://127.0.0.1/api/v1/operator >/dev/null; curl -sk -c $WEB_COOKIE -X POST -H 'content-type: application/json' -d '{\"username\":\"e2e-admin\",\"password\":\"e2e-password-1234\"}' https://127.0.0.1/api/v1/operator/session >/dev/null"; }
web_ok() { ct curl -fsSk -b "$WEB_COOKIE" -m 5 https://127.0.0.1/api/v1/providers; }
cleanup() {
  [ "${E2E_KEEP:-0}" = 1 ] || lxc delete -f "$NAME" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

t_bootstrap_ok() { run_bootstrap "$WORK/install.sh" "$@" >>"$WORK/install.log" 2>&1; }
t_dir_gone() { ! ct test -e "$DIR"; }
t_no_containers() { test -z "$(ct sh -c "docker ps -a --format '{{.Names}}' 2>/dev/null | grep vpngwgui" )"; }
t_no_sysctl() { ! ct test -f /etc/sysctl.d/99-vpngwgui.conf; }
t_no_guard() { ! ct test -f /etc/systemd/system/vpngwgui-boot-guard.service; }
t_guard_not_enabled() { ! ct systemctl is-enabled vpngwgui-boot-guard.service >/dev/null 2>&1; }
t_web_has_adguard() { web_login; web_ok | grep -q adguardvpn; }

COMMIT=$(git -C "$ROOT" rev-parse HEAD)
git -C "$ROOT" diff --quiet HEAD -- install vendors compose docker-compose.yml || echo "注意: install/・vendors/・compose/・docker-compose.yml に未コミットの変更があります（検証されるのはコミット済みの内容です）"
git clone -q --bare "file://$(git -C "$ROOT" rev-parse --absolute-git-dir)" "$WORK/vpngw.git" || exit 1
sh "$ROOT/install/build-bootstrap.sh" e2e "$COMMIT" file:///srv/vpngw.git > "$WORK/install.sh" || exit 1

echo "== 準備: クリーンなコンテナ（$IMAGE）"
lxc delete -f "$NAME" >/dev/null 2>&1
lxc launch "$IMAGE" "$NAME" -c security.nesting=true >/dev/null 2>&1 || { echo "FAIL: コンテナを作れません"; exit 1; }
ct cloud-init status --wait >/dev/null 2>&1
for _ in $(seq 1 30); do ct getent hosts download.docker.com >/dev/null 2>&1 && break; sleep 2; done
lxc file push -r "$WORK/vpngw.git" "$NAME/srv/" >/dev/null && ct chown -R root:root /srv/vpngw.git

echo "== 準備: 頒布URL経由（ブートストラップの標準入力パイプ）で導入する（既定ポート80）"
check "ブートストラップの導入が成功する" t_bootstrap_ok --providers adguardvpn
tail -5 "$WORK/install.log" | sed 's/^/    | /'
web_login
check "Web UIが応答する（ポート80）" web_ok
check "AdGuard VPNが有効なベンダーとして現れる" t_web_has_adguard

echo "== uninstall: 頒布URL経由（同じ標準入力パイプ）で --uninstall を実行する"
check "ブートストラップの--uninstallが成功する" t_bootstrap_ok --uninstall
tail -10 "$WORK/install.log" | sed 's/^/    | /'
check "取得先ディレクトリ（$DIR）自体が削除されている" t_dir_gone
check "docker composeのコンテナが残っていない" t_no_containers
check "IPフォワーディングの設定（sysctl）が削除されている" t_no_sysctl
check "起動時のKill Switchガードのユニットファイルが削除されている" t_no_guard
check "起動時のKill Switchガードが無効（未登録）になっている" t_guard_not_enabled

echo "== reinstall: アンインストール後も、同じ頒布URLで再導入できる"
check "再導入（ブートストラップ）が成功する" t_bootstrap_ok --providers adguardvpn
check "再導入後、取得先ディレクトリが復元されている" ct test -d "$DIR"
web_login
check "再導入後、Web UIが応答する" web_ok

echo "== 結果: FAIL $FAILS 件"
exit "$FAILS"
