#!/bin/sh
# 責務: インストーラのアプリ固有部分（installer/app.sh・setup.sh）の、root権限もネットワークも要らない範囲の検査。
# 内容: 構文、app.shによる設定値からsetup.shの引数への変換、setup.shの引数の解釈。頒布物の生成・導入メタ情報などの共通部分は
#       bootstrap-ci-builderプラグインの検査が受け持つ。
# 実際の導入（apt・Docker・ホスト設定・起動）は、クリーンなLXC環境でのE2E（e2e/phase11/install-scenarios.sh）で検証する。
# 使い方: sh installer/tests/run.sh   出力: 各検査をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=$(CDPATH='' cd -- "$HERE/.." && pwd)
FAILS=0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 目的: 条件を検査して結果を表示する。 入力: 説明, 真のときexit 0となるコマンド...
check() {
  desc=$1; shift
  if "$@"; then echo "PASS: $desc"; else echo "FAIL: $desc"; FAILS=$((FAILS + 1)); fi
}

for script in app.sh setup.sh; do
  check "$script: 構文が正しい" sh -n "$INSTALL_DIR/$script"
done

# --- app.sh: 設定ファイルの値を setup.sh の引数へ変換する（空のキーは渡さない）
# 目的: 指定した設定ファイルの内容で setup_args を実行し、組み立てた引数列を返す。 入力: 設定ファイルの中身。
app_args_with() {
  printf '%s\n' "$1" > "$TMP/app.env"
  sh -c "die() { echo \"エラー: \$*\" >&2; exit 1; }; CONF_FILE='$TMP/app.env'; . '$INSTALL_DIR/app.sh'; setup_args"
}
check "app.sh: 空の設定では引数を渡さない（setup.shの既定・保存済みの値を使わせる）" test "$(app_args_with "PROVIDERS=''")" = ""
check "app.sh: 設定した値だけを対応する引数として渡す" test "$(app_args_with "PROVIDERS='vendora,vendorb'
WEB_PORT='8443'
API_HOST='10.0.0.2'")" = " --providers vendora,vendorb --web-port 8443 --api 10.0.0.2"
check "app.sh: ロールの配置先を --web・--api・--gateway で渡す" test "$(app_args_with "WEB_HOST='w.example'
API_HOST='a.example'
GATEWAY_HOST='g.example'
LAN_IFACE='eth1'")" = " --lan-iface eth1 --web w.example --api a.example --gateway g.example"
check "app.sh: 空白やシェルの特殊文字を含む値は拒否する" sh -c "! (printf '%s\n' \"API_HOST='a;rm'\" > '$TMP/bad.env'; die() { exit 1; }; CONF_FILE='$TMP/bad.env'; . '$INSTALL_DIR/app.sh'; setup_args) >/dev/null 2>&1"

# --- 本体インストーラの引数の解釈（引数の検査はroot権限の検査より前）
check "setup.sh --help は使い方を表示して成功する" sh -c "sh '$INSTALL_DIR/setup.sh' --help | grep -q -- '--providers'"
check "setup.sh: 不明な引数は理由を示して失敗する" sh -c "out=\$(sh '$INSTALL_DIR/setup.sh' --bogus 2>&1); [ \$? -ne 0 ] && printf '%s' \"\$out\" | grep -q '不明な引数'"
check "setup.sh: --providers の値が無ければ失敗する" sh -c "! sh '$INSTALL_DIR/setup.sh' --providers >/dev/null 2>&1"
check "setup.sh --help は --uninstall の使い方も表示する" sh -c "sh '$INSTALL_DIR/setup.sh' --help | grep -q -- '--uninstall'"
check "setup.sh: --keep-data は --uninstall と併用しなければ失敗する" sh -c "out=\$(sh '$INSTALL_DIR/setup.sh' --keep-data 2>&1); [ \$? -ne 0 ] && printf '%s' \"\$out\" | grep -q -- '--keep-data'"

# --- --providers省略時の挙動（Phase 17: all化）。一時ディレクトリに、2つのバンドル（profile.jsonとcompose.ymlを持つ）を持つ
# 偽のリポジトリを作って、関数だけを読み込む（VPNGW_INSTALL_LIBを立てるとmainを実行しない）。
FAKE="$TMP/repo"
mkdir -p "$FAKE/installer" "$FAKE/vendors/vendora" "$FAKE/vendors/vendorb" "$FAKE/vendors/nocompose"
cp "$INSTALL_DIR/setup.sh" "$FAKE/installer/setup.sh"
printf '{ "vendor": "vendora", "displayName": "Vendor A" }\n' > "$FAKE/vendors/vendora/profile.json"
printf '{ "vendor": "vendorb" }\n' > "$FAKE/vendors/vendorb/profile.json"
printf '{ "vendor": "nocompose" }\n' > "$FAKE/vendors/nocompose/profile.json"
: > "$FAKE/vendors/vendora/compose.yml"
: > "$FAKE/vendors/vendorb/compose.yml"
# 目的: determine_providers を実行し、決定されたPROVIDERSを返す。 入力: PROVIDERS_ARGに設定する値（空なら省略扱い）。既存の.envがあれば事前に用意しておく。
setup_providers_with() {
  VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/installer/setup.sh; PROVIDERS_ARG='$1'; determine_providers >/dev/null; printf '%s' \"\$PROVIDERS\""
}
check "--providers省略時: vendors/にある全ベンダー（all）が選ばれる" test "$(setup_providers_with '')" = "vendora,vendorb"
rm -f "$FAKE/.env"
check "--providers指定時: 指定した集合のみが選ばれる（.envの有無に関係しない）" test "$(setup_providers_with 'vendora')" = "vendora"
printf 'VPN_PROVIDERS=vendora\n' > "$FAKE/.env"
check "--providers省略時: 既存の.envのVPN_PROVIDERSが一部でも、全ベンダー（all）になる" test "$(setup_providers_with '')" = "vendora,vendorb"
rm -f "$FAKE/.env"

# --- Web UIのポート（--web-port）
# 目的: setup_web_port を実行し、決定されたWEB_PORTを返す。 入力: WEB_PORT_ARGに設定する値（空なら省略扱い）。既存の.envがあれば事前に用意しておく。
setup_web_port_with() {
  VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/installer/setup.sh; WEB_PORT_ARG='$1'; setup_web_port >/dev/null; printf '%s' \"\$WEB_PORT\""
}
check "--web-port省略時・.env未設定: 既定（443）になる" test "$(setup_web_port_with '')" = "443"
check "--web-port指定時: 指定した値になる" test "$(setup_web_port_with '8080')" = "8080"
printf 'WEB_PORT=8443\n' > "$FAKE/.env"
check "--web-port省略時: .envの既存値を使う" test "$(setup_web_port_with '')" = "8443"
rm -f "$FAKE/.env"
check "--web-port: 範囲外（0）は拒否する" sh -c "! VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/installer/setup.sh; WEB_PORT_ARG=0; setup_web_port' >/dev/null 2>&1"
check "--web-port: 範囲外（65536）は拒否する" sh -c "! VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/installer/setup.sh; WEB_PORT_ARG=65536; setup_web_port' >/dev/null 2>&1"
check "--web-port: 数字以外は拒否する" sh -c "! VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/installer/setup.sh; WEB_PORT_ARG=abc; setup_web_port' >/dev/null 2>&1"

# 目的: 文字列に部分文字列が含まれるか判定する。 入力: 対象の文字列, 探す文字列。
contains() { printf '%s' "$1" | grep -q -- "$2"; }

# 目的: 完了の表示（finish_summary）のWeb UIのURLが、webロールの配置先で確定したポートを示すことを検査する。
#      ローカル配置は setup_web_port → finish_summary の順に呼ぶ（install_roles→finish_summaryと同じ順）。
# 入力: WEB_PORT_ARGに設定する値（空なら省略扱い）。既存の.envがあれば事前に用意しておく。 出力: 完了の表示のうちWeb UIの行。
summary_line_local_with() {
  VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/installer/setup.sh; WEB_PORT_ARG='$1'; ROLE_HOST_web=''; ROLE_HOST_api=''; ROLE_HOST_gateway=''; setup_web_port >/dev/null; finish_summary" | grep 'Web UI:'
}
printf 'WEB_PORT=8443\n' > "$FAKE/.env"
check "完了の表示: --web-port省略時の再実行で、.envに保存済みのポートを表示する" contains "$(summary_line_local_with '')" ':8443（'
check "完了の表示: --web-port指定時は指定したポートを表示する" contains "$(summary_line_local_with 9443)" ':9443（'
rm -f "$FAKE/.env"
check "完了の表示: --web-port省略・.env未設定なら既定（443）を表示する" contains "$(summary_line_local_with '')" ':443（'
rm -f "$FAKE/.env"

# 目的: webロールがリモートの場合、完了の表示がそのホストの.envのWEB_PORTを（sshで）読むことを検査する。
#      sshは偽物（SSH_ASの位置に置いたスクリプト。受け取ったコマンド文字列を記録し、固定の値を返す）で置き換える。
cat > "$TMP/fake-ssh" <<'EOSCRIPT'
#!/bin/sh
# 最後の引数（リモートで実行させるコマンド文字列）を記録し、リモートの.envに保存済みの値として7443を返す。
for last in "$@"; do :; done
printf '%s\n' "$last" >> "$FAKE_SSH_LOG"
printf '7443\n'
EOSCRIPT
chmod +x "$TMP/fake-ssh"
FAKE_SSH_LOG="$TMP/fake-ssh.log"
: > "$FAKE_SSH_LOG"
REMOTE_SUMMARY=$(VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE FAKE_SSH_LOG=$FAKE_SSH_LOG sh -c ". $FAKE/installer/setup.sh; SSH_AS='$TMP/fake-ssh'; WEB_PORT_ARG=''; ROLE_HOST_web=10.0.0.1; ROLE_HOST_api=''; ROLE_HOST_gateway=''; finish_summary" | grep 'Web UI:')
check "完了の表示: webロールがリモートなら、そのホストの.envのWEB_PORTを表示する" contains "$REMOTE_SUMMARY" 'https://10.0.0.1:7443（'
check "完了の表示: リモートの.envのWEB_PORTを読むコマンドを実行する" grep -q "WEB_PORT=.*/opt/vpngwgui/.env" "$FAKE_SSH_LOG"

# 目的: remote_role_argsが、--web-portをwebロールの配置先へだけ転送し、省略時は転送しないことを検査する。
# 入力: roles, WEB_PORT_ARGに設定する値。 出力: 組み立てた引数列。
remote_role_args_with() {
  VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/installer/setup.sh; ROLE_HOST_web=10.0.0.1; ROLE_HOST_api=10.0.0.2; ROLE_HOST_gateway=10.0.0.3; PROVIDERS_ARG=vendora; WEB_PORT_ARG='$2'; remote_role_args '$1'"
}
check "remote_role_args: webロールには--web-portを転送する" test "$(remote_role_args_with web 8443)" = " --api-origin https://10.0.0.2:3000 --web-port 8443"
check "remote_role_args: --web-port省略時は転送しない（リモートの.envの既存値を使わせる）" test "$(remote_role_args_with web '')" = " --api-origin https://10.0.0.2:3000"
check "remote_role_args: webロールを含まないホストへは--web-portを転送しない" test "$(remote_role_args_with gateway 8443)" = " --providers vendora"
check "remote_role_args: apiロールにはgatewayの接続先とベンダーを渡す" test "$(remote_role_args_with api '')" = " --gateway-host 10.0.0.3 --providers vendora"

# --- アンインストール（root・Docker・systemdが要らない範囲。ホスト設定の実際の削除はE2Eで検証する）
check "uninstall_stack: docker-compose.ymlが無ければ何もしない（root不要）" sh -c "VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/installer/setup.sh; uninstall_stack' | grep -q '対象なし'"

# 目的: uninstall_host_hooksが、uninstall-host.shを持つベンダーだけを呼び、実行時の環境変数（VPNGW_ROOT・VPNGW_VENDOR_ID）が
#       install側（VPNGW_ROOT・VPNGW_VENDOR_ID）と同じ契約であること、1つの失敗で後始末全体を止めないことを検査する。
mkdir -p "$FAKE/vendors/vendora"
cat > "$FAKE/vendors/vendora/uninstall-host.sh" <<'EOSCRIPT'
#!/bin/sh
printf 'called:%s:%s\n' "$VPNGW_VENDOR_ID" "$VPNGW_ROOT" >> "$UNINSTALL_LOG"
exit 1
EOSCRIPT
chmod +x "$FAKE/vendors/vendora/uninstall-host.sh"
UNINSTALL_LOG="$TMP/uninstall-hooks.log"
: > "$UNINSTALL_LOG"
VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE UNINSTALL_LOG=$UNINSTALL_LOG sh -c ". $FAKE/installer/setup.sh; uninstall_host_hooks" >/dev/null 2>&1
check "uninstall_host_hooks: uninstall-host.shを持つベンダーだけ呼ばれ、VPNGW_ROOT・VPNGW_VENDOR_IDが渡る" test "$(cat "$UNINSTALL_LOG")" = "called:vendora:$FAKE"
rm -f "$FAKE/vendors/vendora/uninstall-host.sh"

# 目的: uninstall_topology_recordが、配置トポロジーの記録だけを消し、他の設定（WEB_PORT等）は残すことを検査する。
#       記録が残ると、再導入時に証明書が再生成されず、別のトポロジーの指定もエラーになるため。
printf 'WEB_PORT=8443\nTOPOLOGY_RECORDED=1\nTOPOLOGY_WEB_HOST=w.example\nTOPOLOGY_API_HOST=\nTOPOLOGY_GATEWAY_HOST=\n' > "$FAKE/.env"
VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/installer/setup.sh; uninstall_topology_record" >/dev/null 2>&1
check "uninstall_topology_record: TOPOLOGY_*を消し、他の設定は残す" test "$(cat "$FAKE/.env")" = "WEB_PORT=8443"
rm -f "$FAKE/.env"

# 目的: 他テーブルのforward policy dropの検知（warn_foreign_forward_drop）と、稼働中のinet vpngwguiテーブルの削除
#       （uninstall_runtime_nft）を、偽のnftコマンドで検査する（rootもnftablesも要らない）。
FAKE_BIN="$TMP/fake-bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/nft" <<'EONFT'
#!/bin/sh
case "$1 $2" in
  "list ruleset") cat "$FAKE_NFT_RULESET" ;;
  "list table") [ -f "$FAKE_NFT_TABLE_EXISTS" ] ;;
  "delete table") rm -f "$FAKE_NFT_TABLE_EXISTS"; echo "deleted:$3 $4" >> "$FAKE_NFT_LOG" ;;
esac
EONFT
chmod +x "$FAKE_BIN/nft"
FAKE_NFT_RULESET="$TMP/fake-ruleset"
FAKE_NFT_TABLE_EXISTS="$TMP/fake-table-exists"
FAKE_NFT_LOG="$TMP/fake-nft.log"
cat > "$FAKE_NFT_RULESET" <<'ERULES'
table inet other_filter {
	chain forward {
		type filter hook forward priority filter; policy drop;
		ip saddr 192.168.0.0/24 accept
	}
}
table inet vpngwgui {
	chain forward {
		type filter hook forward priority filter; policy drop;
	}
}
table ip filter {
	chain FORWARD {
		type filter hook forward priority filter; policy accept;
	}
}
ERULES
WARN_OUT=$(PATH="$FAKE_BIN:$PATH" FAKE_NFT_RULESET=$FAKE_NFT_RULESET VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/installer/setup.sh; warn_foreign_forward_drop" 2>&1)
check "warn_foreign_forward_drop: 他テーブルのforward policy dropを警告する" contains "$WARN_OUT" 'inet other_filter / forward'
check "warn_foreign_forward_drop: 当製品のテーブル（vpngwgui）・policy acceptは警告しない" sh -c "! printf '%s' '$WARN_OUT' | grep -q -e vpngwgui -e 'ip filter'"
printf 'table ip filter {\n\tchain FORWARD {\n\t\ttype filter hook forward priority filter; policy accept;\n\t}\n}\n' > "$FAKE_NFT_RULESET"
check "warn_foreign_forward_drop: 該当が無ければ何も出さない" test -z "$(PATH="$FAKE_BIN:$PATH" FAKE_NFT_RULESET=$FAKE_NFT_RULESET VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/installer/setup.sh; warn_foreign_forward_drop" 2>&1)"

: > "$FAKE_NFT_TABLE_EXISTS"
: > "$FAKE_NFT_LOG"
PATH="$FAKE_BIN:$PATH" FAKE_NFT_TABLE_EXISTS=$FAKE_NFT_TABLE_EXISTS FAKE_NFT_LOG=$FAKE_NFT_LOG VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/installer/setup.sh; uninstall_runtime_nft" >/dev/null 2>&1
check "uninstall_runtime_nft: inet vpngwguiがあれば削除する" grep -q 'deleted:inet vpngwgui' "$FAKE_NFT_LOG"
: > "$FAKE_NFT_LOG"
PATH="$FAKE_BIN:$PATH" FAKE_NFT_TABLE_EXISTS=$FAKE_NFT_TABLE_EXISTS FAKE_NFT_LOG=$FAKE_NFT_LOG VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/installer/setup.sh; uninstall_runtime_nft" >/dev/null 2>&1
check "uninstall_runtime_nft: テーブルが無ければ何もしない" test ! -s "$FAKE_NFT_LOG"

# install.sh.tmpl（雛形）の--uninstall分岐（本体インストーラへ--uninstallを渡して実行した後、DIRごと削除する）は
# root権限を要するため（雛形の冒頭でroot確認する）、ここでは検査しない。e2e/phase20/uninstall-scenarios.shで検査する。

# --- デプロイメント構成の分離（Phase25 Stage3）: トポロジー決定・SAN組み立て・ロールごとのCOMPOSE_FILE構築
rm -f "$FAKE/.env"

check "build_san: ローカル配置時はlocalhost/127.0.0.1に加えLAN側アドレスを含む" sh -c \
  "VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/installer/setup.sh; build_san \"\" \"\"' | grep -q 'DNS:localhost,IP:127.0.0.1'"
check "build_san: ホスト名指定時はDNS:として含む" sh -c \
  "VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/installer/setup.sh; build_san example.internal \"\"' | grep -q 'DNS:example.internal'"
check "build_san: IPv4指定時はIP:として含む" sh -c \
  "VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/installer/setup.sh; build_san 192.168.1.5 \"\"' | grep -q 'IP:192.168.1.5'"
check "build_san: 追加のSAN項目（extra）を含める" sh -c \
  "VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/installer/setup.sh; build_san \"\" DNS:api' | grep -q 'DNS:api'"

check "determine_topology: 初回は--api/--web/--gatewayの指定をそのまま採用する" test \
  "$(VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/installer/setup.sh; WEB_HOST_ARG=w.example; API_HOST_ARG=a.example; GATEWAY_HOST_ARG=; determine_topology >/dev/null; printf '%s:%s:%s' \"\$ROLE_HOST_web\" \"\$ROLE_HOST_api\" \"\$ROLE_HOST_gateway\"")" = "w.example:a.example:"

printf 'TOPOLOGY_RECORDED=1\nTOPOLOGY_WEB_HOST=w.example\nTOPOLOGY_API_HOST=a.example\nTOPOLOGY_GATEWAY_HOST=\n' > "$FAKE/.env"
check "determine_topology: 記録済みトポロジーと一致すれば成功する" sh -c \
  "VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/installer/setup.sh; WEB_HOST_ARG=w.example; API_HOST_ARG=a.example; GATEWAY_HOST_ARG=; determine_topology' >/dev/null 2>&1"
check "determine_topology: 記録済みトポロジーと異なれば変更前に失敗する" sh -c \
  "! VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/installer/setup.sh; WEB_HOST_ARG=other.example; API_HOST_ARG=a.example; GATEWAY_HOST_ARG=; determine_topology' >/dev/null 2>&1"
rm -f "$FAKE/.env"

# 目的: distinct_remote_hostsが、ホストのIPアドレス等の文字列順ではなく、ロールの依存関係の順（gateway→api→web）で
#      返すことを検証する（webの起動確認がapiロールの疎通を要するため、apiが先に導入済みでなければならない。
#      3台分離構成の実機検証で見つけた不具合の再発防止）。
check "distinct_remote_hosts: IPが若い順ではなくgateway→api→webの順で返す（webのIPが最も若い場合）" test \
  "$(VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/installer/setup.sh; ROLE_HOST_web=10.0.0.1; ROLE_HOST_api=10.0.0.2; ROLE_HOST_gateway=10.0.0.3; distinct_remote_hosts" | tr '\n' ,)" = "10.0.0.3,10.0.0.2,10.0.0.1,"
check "distinct_remote_hosts: 同じホストに複数ロールがあっても重複せず1回だけ返す" test \
  "$(VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/installer/setup.sh; ROLE_HOST_web=10.0.0.9; ROLE_HOST_api=10.0.0.9; ROLE_HOST_gateway=10.0.0.3; distinct_remote_hosts" | tr '\n' ,)" = "10.0.0.3,10.0.0.9,"

check "setup.sh: --uninstall は --api と併用できない" sh -c \
  "! sh '$INSTALL_DIR/setup.sh' --uninstall --api example.internal >/dev/null 2>&1"

# 目的: install_rolesが、割り当てられたロールだけのcompose/*.ymlをCOMPOSE_FILEへ並べることを検査する
#      （gatewayロールを含まない場合はベンダーのcompose fragmentを並べない）。DockerもNO_START=1で回避する。
install_roles_compose_file_with() {
  VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c \
    ". $FAKE/installer/setup.sh; NO_START=1; GATEWAY_HOST_OVERRIDE_ARG=''; API_ORIGIN_OVERRIDE_ARG=''; preflight() { :; }; install_packages() { :; }; install_docker() { :; }; install_roles '$1' >/dev/null 2>&1; env_get COMPOSE_FILE"
}
check "install_roles: webロールのみの場合、compose/web.ymlだけを並べる（ベンダーfragmentは含めない）" test \
  "$(install_roles_compose_file_with web)" = "docker-compose.yml:compose/web.yml"
rm -f "$FAKE/.env"
check "install_roles: web+apiロールの場合、両方のcompose fragmentを並べる" test \
  "$(install_roles_compose_file_with web,api)" = "docker-compose.yml:compose/web.yml:compose/api.yml"
rm -f "$FAKE/.env"

# --- --rotate-pairingの核（証明書の再生成）: generate_role_pkiはroot権限・ネットワーク不要（opensslのみ）で
# 完結するため、ここで「2回呼べば鍵材料が入れ替わる」という再生成の保証を検証する。distribute_pki_local/remote
# （root権限・SSHを要する配布そのもの）はこのテストの対象外とし、実機検証（tasks.md参照）に委ねる。
regenerate_pki_fingerprints() {
  VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c "
    . $FAKE/installer/setup.sh
    ROLE_HOST_web=''; ROLE_HOST_api=''; ROLE_HOST_gateway=''
    generate_role_pki >/dev/null 2>&1
    fp1=\$(openssl x509 -noout -fingerprint -sha256 -in \"\$PKI_STAGING/web-server.crt\")
    rm -rf \"\$PKI_STAGING\"
    generate_role_pki >/dev/null 2>&1
    fp2=\$(openssl x509 -noout -fingerprint -sha256 -in \"\$PKI_STAGING/web-server.crt\")
    rm -rf \"\$PKI_STAGING\"
    printf '%s\n%s\n' \"\$fp1\" \"\$fp2\"
  "
}
PKI_FINGERPRINTS=$(regenerate_pki_fingerprints)
PKI_FP1=$(printf '%s\n' "$PKI_FINGERPRINTS" | sed -n 1p)
PKI_FP2=$(printf '%s\n' "$PKI_FINGERPRINTS" | sed -n 2p)
check "generate_role_pki: 2回連続で呼ぶと証明書（web-server.crt）のフィンガープリントが変わる（再生成保証）" \
  sh -c "[ -n '$PKI_FP1' ] && [ -n '$PKI_FP2' ] && [ '$PKI_FP1' != '$PKI_FP2' ]"

# --- app.sh: 設定を書き込む前の検査（app_check）。偽のリポジトリ（vendors/vendora・vendorb）を取得先とみなす。
# 目的: PROVIDERS・WEB_PORT を与えて app_check を実行する。 入力: PROVIDERS の値, WEB_PORT の値。 終了コード: 検査に通れば 0。
app_check_with() {
  sh -c "die() { echo \"エラー: \$*\" >&2; exit 1; }
    config_value() { case \$1 in PROVIDERS) printf '%s' '$1' ;; WEB_PORT) printf '%s' '$2' ;; esac; }
    DIR='$FAKE'; . '$INSTALL_DIR/app.sh'; app_check" >/dev/null 2>&1
}
check "app_check: 空の設定は通す" app_check_with "" ""
check "app_check: 存在するベンダーとポートは通す" app_check_with "vendora,vendorb" 8443
# 目的: app_check が拒否する（終了コードが非ゼロ）ことを検査する。 入力: app_check_with と同じ。
app_check_rejects() { ! app_check_with "$@"; }
check "app_check: 存在しないベンダーは拒否する" app_check_rejects nosuch ""
check "app_check: パスを含むベンダーIDは拒否する" app_check_rejects ../etc ""
check "app_check: 範囲外のポートは拒否する" app_check_rejects "" 70000
check "app_check: 数字以外のポートは拒否する" app_check_rejects "" abc

echo "== 結果: FAIL $FAILS 件"
exit "$FAILS"
