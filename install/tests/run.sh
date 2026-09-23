#!/bin/sh
# 責務: インストーラ関連スクリプト（install/bootstrap.sh・build-bootstrap.sh・install.sh）の、root権限もネットワークも要らない範囲の検査。
# 内容: 構文、頒布物の生成（値の埋め込み・置換漏れ・不正な引数の拒否）、雛形のまま実行した場合の中止、install.shの引数の解釈。
# 実際の導入（apt・Docker・ホスト設定・起動）は、クリーンなLXC環境でのE2E（e2e/phase11/install-scenarios.sh）で検証する。
# 使い方: sh install/tests/run.sh   出力: 各検査をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=$(CDPATH='' cd -- "$HERE/.." && pwd)
FAILS=0
COMMIT=0123456789abcdef0123456789abcdef01234567
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 目的: 条件を検査して結果を表示する。 入力: 説明, 真のときexit 0となるコマンド...
check() {
  desc=$1; shift
  if "$@"; then echo "PASS: $desc"; else echo "FAIL: $desc"; FAILS=$((FAILS + 1)); fi
}

for script in bootstrap.sh build-bootstrap.sh install.sh; do
  check "$script: 構文が正しい" sh -n "$INSTALL_DIR/$script"
done

# --- 頒布物の生成
sh "$INSTALL_DIR/build-bootstrap.sh" v1.2.3 "$COMMIT" https://example.test/org/repo.git > "$TMP/install.sh"
check "生成: REF・COMMIT・REPO_URLが埋め込まれる" sh -c "grep -q \"^REF='v1.2.3'\" '$TMP/install.sh' && grep -q \"^COMMIT='$COMMIT'\" '$TMP/install.sh' && grep -q \"^REPO_URL='https://example.test/org/repo.git'\" '$TMP/install.sh'"
check "生成: 代入行に置換漏れが無い" sh -c "! grep -q \"^\\(REF\\|COMMIT\\|REPO_URL\\)='@@\" '$TMP/install.sh'"
check "生成: 生成物の構文が正しい" sh -n "$TMP/install.sh"
sh "$INSTALL_DIR/build-bootstrap.sh" feature/x-1 "$COMMIT" file:///srv/repo.git > "$TMP/branch.sh"
check "生成: ブランチ名（/を含む）・file://も受け付ける" grep -q "^REF='feature/x-1'" "$TMP/branch.sh"

# 目的: 生成スクリプトが、引数を拒否する（終了コードが非ゼロで、標準出力に何も出さない）ことを検査する。 入力: 生成スクリプトへ渡す引数。
# shellcheck disable=SC2317,SC2329  # check経由で呼ばれる（間接呼び出し。shellcheckの版により指摘のコードが異なる）
rejects() {
  out=$(sh "$INSTALL_DIR/build-bootstrap.sh" "$@" 2>/dev/null)
  rc=$?
  [ "$rc" -ne 0 ] && [ -z "$out" ]
}
for bad in "bad ref" "ref'quote" 'ref|pipe' 'ref&amp'; do
  check "生成: 不正なREF（$bad）を拒否し、何も出力しない" rejects "$bad" "$COMMIT" https://example.test/r.git
done
check "生成: 40桁でないCOMMITを拒否する" rejects v1 abc123 https://example.test/r.git
check "生成: 大文字のCOMMITを拒否する" rejects v1 0123456789ABCDEF0123456789abcdef01234567 https://example.test/r.git
check "生成: https・file以外のREPO_URLを拒否する" rejects v1 "$COMMIT" http://example.test/r.git
check "生成: 引用符を含むREPO_URLを拒否する" rejects v1 "$COMMIT" "https://example.test/r'.git"
check "生成: 引数の数が違えば失敗する" rejects v1

# --- 雛形のまま実行した場合の中止（root権限の検査より前に判定するため、一般ユーザーでも確認できる）
check "雛形のまま実行すると、雛形である旨を示して中止する" sh -c "out=\$(sh '$INSTALL_DIR/bootstrap.sh' 2>&1); [ \$? -ne 0 ] && printf '%s' \"\$out\" | grep -q '雛形'"

# --- 本体インストーラの引数の解釈（引数の検査はroot権限の検査より前）
check "install.sh --help は使い方を表示して成功する" sh -c "sh '$INSTALL_DIR/install.sh' --help | grep -q -- '--providers'"
check "install.sh: 不明な引数は理由を示して失敗する" sh -c "out=\$(sh '$INSTALL_DIR/install.sh' --bogus 2>&1); [ \$? -ne 0 ] && printf '%s' \"\$out\" | grep -q '不明な引数'"
check "install.sh: --providers の値が無ければ失敗する" sh -c "! sh '$INSTALL_DIR/install.sh' --providers >/dev/null 2>&1"
check "install.sh --help は --uninstall の使い方も表示する" sh -c "sh '$INSTALL_DIR/install.sh' --help | grep -q -- '--uninstall'"
check "install.sh: --keep-data は --uninstall と併用しなければ失敗する" sh -c "out=\$(sh '$INSTALL_DIR/install.sh' --keep-data 2>&1); [ \$? -ne 0 ] && printf '%s' \"\$out\" | grep -q -- '--keep-data'"

# --- --providers省略時の挙動（Phase 17: all化）。一時ディレクトリに、2つのバンドル（profile.jsonとcompose.ymlを持つ）を持つ
# 偽のリポジトリを作って、関数だけを読み込む（VPNGW_INSTALL_LIBを立てるとmainを実行しない）。
FAKE="$TMP/repo"
mkdir -p "$FAKE/install" "$FAKE/vendors/vendora" "$FAKE/vendors/vendorb" "$FAKE/vendors/nocompose"
cp "$INSTALL_DIR/install.sh" "$FAKE/install/install.sh"
printf '{ "vendor": "vendora", "displayName": "Vendor A" }\n' > "$FAKE/vendors/vendora/profile.json"
printf '{ "vendor": "vendorb" }\n' > "$FAKE/vendors/vendorb/profile.json"
printf '{ "vendor": "nocompose" }\n' > "$FAKE/vendors/nocompose/profile.json"
: > "$FAKE/vendors/vendora/compose.yml"
: > "$FAKE/vendors/vendorb/compose.yml"
# 目的: determine_providers を実行し、決定されたPROVIDERSを返す。 入力: PROVIDERS_ARGに設定する値（空なら省略扱い）。既存の.envがあれば事前に用意しておく。
setup_providers_with() {
  VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/install/install.sh; PROVIDERS_ARG='$1'; determine_providers >/dev/null; printf '%s' \"\$PROVIDERS\""
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
  VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/install/install.sh; WEB_PORT_ARG='$1'; setup_web_port >/dev/null; printf '%s' \"\$WEB_PORT\""
}
check "--web-port省略時・.env未設定: 既定（80）になる" test "$(setup_web_port_with '')" = "80"
check "--web-port指定時: 指定した値になる" test "$(setup_web_port_with '8080')" = "8080"
printf 'WEB_PORT=8443\n' > "$FAKE/.env"
check "--web-port省略時: .envの既存値を使う" test "$(setup_web_port_with '')" = "8443"
rm -f "$FAKE/.env"
check "--web-port: 範囲外（0）は拒否する" sh -c "! VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/install/install.sh; WEB_PORT_ARG=0; setup_web_port' >/dev/null 2>&1"
check "--web-port: 範囲外（65536）は拒否する" sh -c "! VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/install/install.sh; WEB_PORT_ARG=65536; setup_web_port' >/dev/null 2>&1"
check "--web-port: 数字以外は拒否する" sh -c "! VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/install/install.sh; WEB_PORT_ARG=abc; setup_web_port' >/dev/null 2>&1"

# --- アンインストール（root・Docker・systemdが要らない範囲。ホスト設定の実際の削除はE2Eで検証する）
check "uninstall_stack: docker-compose.ymlが無ければ何もしない（root不要）" sh -c "VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/install/install.sh; uninstall_stack' | grep -q '対象なし'"

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
VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE UNINSTALL_LOG=$UNINSTALL_LOG sh -c ". $FAKE/install/install.sh; uninstall_host_hooks" >/dev/null 2>&1
check "uninstall_host_hooks: uninstall-host.shを持つベンダーだけ呼ばれ、VPNGW_ROOT・VPNGW_VENDOR_IDが渡る" test "$(cat "$UNINSTALL_LOG")" = "called:vendora:$FAKE"
rm -f "$FAKE/vendors/vendora/uninstall-host.sh"

# 目的: remove_repo_rootが、REPO_ROOT（install/install.shを含む取得先ディレクトリ）を削除することを検査する。
# FAKEを直接使うと後続の（存在しない）テストで壊れるため、専用のコピーに対して実行する。危険なパス（空・/・install.shが無い）は
# 中止すること（誤って無関係なディレクトリを消さない安全対策）も検査する。
REMOVE_TARGET="$TMP/remove-target"
cp -r "$FAKE" "$REMOVE_TARGET"
VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$REMOVE_TARGET sh -c ". $REMOVE_TARGET/install/install.sh; remove_repo_root" >/dev/null 2>&1
check "remove_repo_root: REPO_ROOT自体を削除する" sh -c "[ ! -e '$REMOVE_TARGET' ]"
NOT_A_REPO="$TMP/not-a-repo"
mkdir -p "$NOT_A_REPO"
check "remove_repo_root: install/install.shが無いディレクトリは削除を拒否する" sh -c "! VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$NOT_A_REPO sh -c '. $FAKE/install/install.sh; remove_repo_root' >/dev/null 2>&1"
check "remove_repo_root: 拒否時にディレクトリが残る" test -d "$NOT_A_REPO"

# --- デプロイメント構成の分離（Phase25 Stage3）: トポロジー決定・SAN組み立て・ロールごとのCOMPOSE_FILE構築
rm -f "$FAKE/.env"

check "build_san: ローカル配置時はlocalhost/127.0.0.1に加えLAN側アドレスを含む" sh -c \
  "VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/install/install.sh; build_san \"\" \"\"' | grep -q 'DNS:localhost,IP:127.0.0.1'"
check "build_san: ホスト名指定時はDNS:として含む" sh -c \
  "VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/install/install.sh; build_san example.internal \"\"' | grep -q 'DNS:example.internal'"
check "build_san: IPv4指定時はIP:として含む" sh -c \
  "VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/install/install.sh; build_san 192.168.1.5 \"\"' | grep -q 'IP:192.168.1.5'"
check "build_san: 追加のSAN項目（extra）を含める" sh -c \
  "VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/install/install.sh; build_san \"\" DNS:api' | grep -q 'DNS:api'"

check "determine_topology: 初回は--api/--web/--gatewayの指定をそのまま採用する" test \
  "$(VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c ". $FAKE/install/install.sh; WEB_HOST_ARG=w.example; API_HOST_ARG=a.example; GATEWAY_HOST_ARG=; determine_topology >/dev/null; printf '%s:%s:%s' \"\$ROLE_HOST_web\" \"\$ROLE_HOST_api\" \"\$ROLE_HOST_gateway\"")" = "w.example:a.example:"

printf 'TOPOLOGY_RECORDED=1\nTOPOLOGY_WEB_HOST=w.example\nTOPOLOGY_API_HOST=a.example\nTOPOLOGY_GATEWAY_HOST=\n' > "$FAKE/.env"
check "determine_topology: 記録済みトポロジーと一致すれば成功する" sh -c \
  "VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/install/install.sh; WEB_HOST_ARG=w.example; API_HOST_ARG=a.example; GATEWAY_HOST_ARG=; determine_topology' >/dev/null 2>&1"
check "determine_topology: 記録済みトポロジーと異なれば変更前に失敗する" sh -c \
  "! VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c '. $FAKE/install/install.sh; WEB_HOST_ARG=other.example; API_HOST_ARG=a.example; GATEWAY_HOST_ARG=; determine_topology' >/dev/null 2>&1"
rm -f "$FAKE/.env"

check "install.sh: --uninstall は --api と併用できない" sh -c \
  "! sh '$INSTALL_DIR/install.sh' --uninstall --api example.internal >/dev/null 2>&1"

# 目的: install_rolesが、割り当てられたロールだけのcompose/*.ymlをCOMPOSE_FILEへ並べることを検査する
#      （gatewayロールを含まない場合はベンダーのcompose fragmentを並べない）。DockerもNO_START=1で回避する。
install_roles_compose_file_with() {
  VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE sh -c \
    ". $FAKE/install/install.sh; NO_START=1; GATEWAY_HOST_OVERRIDE_ARG=''; API_ORIGIN_OVERRIDE_ARG=''; preflight() { :; }; install_packages() { :; }; install_docker() { :; }; install_roles '$1' >/dev/null 2>&1; env_get COMPOSE_FILE"
}
check "install_roles: webロールのみの場合、compose/web.ymlだけを並べる（ベンダーfragmentは含めない）" test \
  "$(install_roles_compose_file_with web)" = "docker-compose.yml:compose/web.yml"
rm -f "$FAKE/.env"
check "install_roles: web+apiロールの場合、両方のcompose fragmentを並べる" test \
  "$(install_roles_compose_file_with web,api)" = "docker-compose.yml:compose/web.yml:compose/api.yml"
rm -f "$FAKE/.env"

echo "== 結果: FAIL $FAILS 件"
exit "$FAILS"
