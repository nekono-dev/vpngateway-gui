#!/bin/bash
# 責務: Phase 11完了基準のうち、インストーラ（ブートストラップ→本体）の、クリーンなOSでの導入・再実行・ベンダーの変更・
#       ホスト側フック・失敗系を、LXCのクリーンなコンテナで検証する。実VPN・実LANは使わない（導入と起動までが対象）。
# 実行: bash e2e/phase11/install-scenarios.sh [イメージ（既定 ubuntu:24.04。例 images:debian/12 やローカルのイメージのフィンガープリント）]
# 前提: 開発ホストにLXD（lxc）・git。検証対象のコミットは**コミット済み**であること（ブートストラップはコミットを固定して取得するため）。
#       コンテナ名は E2E_CONTAINER（既定 vpngw-inst）。既にあれば削除して作り直す。終了時に削除する（E2E_KEEP=1で残す）。
#       取得元（REPO_URL）は、開発ホストのリポジトリから作った裸リポジトリをコンテナ内 /srv/vpngw.git に置き、file://で指す
#       （GitHubへのpushやReleaseは使わない。頒布の経路そのものは、pushの許可を得た後に確認する）。
# 出力: 各検証をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
ROOT=$(CDPATH='' cd -- "$HERE/../.." && pwd)
IMAGE=${1:-ubuntu:24.04}
NAME=${E2E_CONTAINER:-vpngw-inst}
WORK=$(mktemp -d)
FAILS=0
DIR=/opt/vpngwgui

check() { # check <説明> <条件が真のときexit 0となる関数・コマンド...>
  local desc=$1; shift
  if "$@"; then echo "PASS: $desc"; else echo "FAIL: $desc"; FAILS=$((FAILS+1)); fi
}
ct() { lxc exec "$NAME" -- "$@"; }              # コンテナ内でコマンドを実行する
sh_ct() { lxc exec "$NAME" -- sh -c "$1"; }     # コンテナ内でシェル文字列を実行する
# 頒布物（ブートストラップ）を、`curl | sh`と同じく標準入力のパイプで実行する。 入力: 頒布物のファイル, 本体への引数...
run_bootstrap() { local f=$1; shift; lxc exec "$NAME" -- sh -s -- "$@" < "$f"; }
WEB_COOKIE=/tmp/e2e-cookie.txt
# Phase25でAPIが認証必須になったため、E2E共通アカウント（初回のみ作成）でログインしてから叩く。
# apiコンテナが再作成されるたびセッション（プロセスメモリ）がリセットされるため、web_ok()の呼び出し側
# （t_web_has/t_web_lacks）で毎回ログインし直す。
# Phase25 Stage3でwebサーバが自己署名証明書のHTTPSになったため、-k（証明書検証省略）を付ける。
web_login() { ct sh -c "curl -sk -c $WEB_COOKIE -X POST -H 'content-type: application/json' -d '{\"username\":\"e2e-admin\",\"password\":\"e2e-password-1234\"}' https://127.0.0.1:8080/api/v1/operator >/dev/null; curl -sk -c $WEB_COOKIE -X POST -H 'content-type: application/json' -d '{\"username\":\"e2e-admin\",\"password\":\"e2e-password-1234\"}' https://127.0.0.1:8080/api/v1/operator/session >/dev/null"; }
web_ok() { ct curl -fsSk -b "$WEB_COOKIE" -m 5 https://127.0.0.1:8080/api/v1/providers; }
env_val() { ct sh -c "grep '^$1=' $DIR/.env | tail -n 1 | cut -d= -f2-"; }
running_services() { ct sh -c "cd $DIR && docker compose ps --services --status running | sort | tr '\n' ' '"; }
cleanup() {
  [ "${E2E_KEEP:-0}" = 1 ] || lxc delete -f "$NAME" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

# --- 検査の関数（checkへ渡す）
t_no_docker() { ! ct sh -c 'command -v docker' >/dev/null 2>&1; }
t_bootstrap_ok() { run_bootstrap "$WORK/install.sh" "$@" >>"$WORK/install.log" 2>&1; }
t_bootstrap_fails_with() { # <ログに含まれる文字列> <引数...>
  local expect=$1; shift
  ! run_bootstrap "${BOOT:-$WORK/install.sh}" "$@" >"$WORK/fail.log" 2>&1 && grep -q -- "$expect" "$WORK/fail.log"
}
t_head_is() { test "$(ct git -C "$DIR" rev-parse HEAD)" = "$1"; }
t_docker_official() { ct docker compose version >/dev/null && ct grep -q download.docker.com /etc/apt/sources.list.d/docker.list; }
t_sysctl() { ct grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.d/99-vpngwgui.conf; }
t_guard() { ct systemctl is-enabled vpngwgui-boot-guard.service | grep -q enabled; }
t_env_initial() { test "$(env_val VPN_PROVIDERS)" = adguardvpn && test "$(env_val COMPOSE_FILE)" = "docker-compose.yml:compose/web.yml:compose/api.yml:compose/gateway.yml:vendors/adguardvpn/compose.yml" && test -n "$(env_val LAN_IFACE)"; }
t_web_has() { web_login; web_ok | grep -q "$1"; }
t_web_lacks() { web_login; web_ok >/dev/null && ! web_ok | grep -q "$1"; }
t_services_are() { test "$(running_services)" = "$1 "; }
t_env_unchanged() { test "$(ct cat $DIR/.env)" = "$BEFORE_ENV"; }
t_hook_contract() { test "$(ct cat /tmp/hook-ran)" = "hooktest $DIR $DIR/vendors/hooktest"; }
t_added() { test "$(env_val VPN_PROVIDERS)" = adguardvpn,hooktest && running_services | grep -q runner-hooktest && t_web_has hooktest; }
t_orphan_removed() { ! ct sh -c 'docker ps -a --format {{.Names}}' | grep -q hooktest; }

COMMIT=$(git -C "$ROOT" rev-parse HEAD)
git -C "$ROOT" diff --quiet HEAD -- install vendors compose docker-compose.yml || echo "注意: install/・vendors/・compose/・docker-compose.yml に未コミットの変更があります（検証されるのはコミット済みの内容です）"
git clone -q --bare "file://$(git -C "$ROOT" rev-parse --git-common-dir)" "$WORK/vpngw.git" || exit 1
sh "$ROOT/install/build-bootstrap.sh" e2e "$COMMIT" file:///srv/vpngw.git > "$WORK/install.sh" || exit 1
sh "$ROOT/install/build-bootstrap.sh" e2e 0000000000000000000000000000000000000000 file:///srv/vpngw.git > "$WORK/install-bad.sh" || exit 1

echo "== 準備: クリーンなコンテナ（$IMAGE）"
lxc delete -f "$NAME" >/dev/null 2>&1
lxc launch "$IMAGE" "$NAME" -c security.nesting=true >/dev/null 2>&1 || { echo "FAIL: コンテナを作れません"; exit 1; }
ct cloud-init status --wait >/dev/null 2>&1
for _ in $(seq 1 30); do ct getent hosts download.docker.com >/dev/null 2>&1 && break; sleep 2; done
lxc file push -r "$WORK/vpngw.git" "$NAME/srv/" >/dev/null && ct chown -R root:root /srv/vpngw.git
check "クリーンな状態（dockerが無い）" t_no_docker

echo "== install: 1コマンド（標準入力のパイプ）で導入・起動する"
check "ブートストラップが成功する（--providers指定）" t_bootstrap_ok --providers adguardvpn
tail -5 "$WORK/install.log" | sed 's/^/    | /'
check "取得したソースが、埋め込まれたコミットと一致する" t_head_is "$COMMIT"
check "Docker（公式リポジトリ）とcompose v2が導入されている" t_docker_official
check "sysctl設定（IPフォワーディング）が作られている" t_sysctl
check "起動時のKill Switchガードが有効化されている" t_guard
check ".envにLAN_IFACE・VPN_PROVIDERS・COMPOSE_FILEが書かれている" t_env_initial
check "Web UIが応答し、有効なベンダーが現れる" t_web_has adguardvpn
check "有効なベンダーのランナーだけが起動している（web・api・proxy・runner-adguardvpn）" t_services_are "api proxy runner-adguardvpn web"

echo "== rerun: 引数なしの再実行は冪等で、既存の設定を維持する"
BEFORE_ENV=$(ct cat "$DIR/.env")
check "引数なしの再実行（更新）が成功する" t_bootstrap_ok
check ".envが変わらない（LAN_IFACE・有効なベンダー・composeの合成を維持）" t_env_unchanged
check "再実行後もWeb UIが応答する" t_web_has adguardvpn

echo "== providers: ベンダーの追加・削除とホスト側フック"
# 追加のベンダー（このコンテナ内だけの検証用バンドル。共通部は変更しない）。フックとcomposeのfragmentを持つ。
ct sh -c "mkdir -p $DIR/vendors/hooktest && cd $DIR/vendors/hooktest &&
  cp ../adguardvpn/profile.json profile.json && sed -i 's/adguardvpn/hooktest/g; s/\"displayName\": \"[^\"]*\"/\"displayName\": \"Hook Test\"/' profile.json &&
  printf 'services:\n  runner-hooktest:\n    image: alpine:3\n    command: sleep 3600\n' > compose.yml &&
  printf '#!/bin/sh\necho \"\$VPNGW_VENDOR_ID \$VPNGW_ROOT \$(pwd)\" > /tmp/hook-ran\n' > install-host.sh"
check "--providersで追加すると、そのバンドルのinstall-host.shが実行される" t_bootstrap_ok --providers adguardvpn,hooktest
check "フックの契約: VPNGW_VENDOR_ID・VPNGW_ROOT・カレントディレクトリ" t_hook_contract
check "追加したベンダーが.envに反映され、そのランナーが起動し、APIの一覧に現れる" t_added
check "--providersで外すと、そのランナーが停止・削除される（--remove-orphans）" t_bootstrap_ok --providers adguardvpn
check "外したランナーのコンテナが残っていない" t_orphan_removed
check "外した後もWeb UIが応答し、外したベンダーは一覧に無い" t_web_lacks hooktest
ct sh -c "printf '#!/bin/sh\nexit 3\n' > $DIR/vendors/hooktest/install-host.sh"
check "フックが失敗したら、起動の前にインストールを中止する（非ゼロ終了・理由の表示）" t_bootstrap_fails_with install-host.sh --providers adguardvpn,hooktest
ct rm -rf "$DIR/vendors/hooktest"
check "存在しないベンダーIDは、選べるものを示して失敗する" t_bootstrap_fails_with "ベンダーバンドルがありません" --providers nosuchvendor
check "不正なベンダーID（パス注入）は失敗する" t_bootstrap_fails_with "不正なベンダーID" --providers ../etc

echo "== fail: ベンダーが決められない・取得の食い違い・作業ツリーの変更"
ct sh -c "sed -i '/^VPN_PROVIDERS=/d; /^COMPOSE_FILE=/d' $DIR/.env"
check "指定も既存値も端末も無ければ、既定のベンダーを持たないため失敗する" t_bootstrap_fails_with "--providers" --no-start
t_bootstrap_ok --providers adguardvpn --no-start
BOOT="$WORK/install-bad.sh"
check "存在しないコミットを埋め込んだ頒布物は、取得に失敗して何も実行しない" t_bootstrap_fails_with fatal --providers adguardvpn
BOOT=""
check "失敗後もソースは元のコミットのまま" t_head_is "$COMMIT"
ct sh -c "echo '# local edit' >> $DIR/compose/gateway.yml"
check "追跡ファイルに未コミットの変更があれば、更新せず中止する" t_bootstrap_fails_with "未コミットの変更" --providers adguardvpn
ct git -C "$DIR" checkout -q -- compose/gateway.yml
check "変更を戻せば、再び更新できる" t_bootstrap_ok --providers adguardvpn --no-start

echo "== 結果: FAIL $FAILS 件"
exit "$FAILS"
