#!/bin/sh
# 責務: インストーラ関連スクリプト（install/bootstrap.sh・build-bootstrap.sh・install.sh）の、root権限もネットワークも要らない範囲の検査。
# 内容: 構文、頒布物の生成（値の埋め込み・置換漏れ・不正な引数の拒否）、雛形のまま実行した場合の中止、install.shの引数の解釈。
# 実際の導入（apt・Docker・ホスト設定・起動）は、クリーンなLXC環境でのE2E（wbs/phase13.md）で検証する。
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
# shellcheck disable=SC2329  # check経由で呼ばれる（間接呼び出し）
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

# --- 対話選択（/dev/ttyから読む。`curl | sh`では標準入力がパイプのため）。scriptコマンドで擬似端末を与え、入力を流し込む。
# 一時ディレクトリに、2つのバンドル（profile.jsonとcompose.ymlを持つ）を持つ偽のリポジトリを作って、関数だけを読み込む。
FAKE="$TMP/repo"
mkdir -p "$FAKE/install" "$FAKE/vendors/vendora" "$FAKE/vendors/vendorb" "$FAKE/vendors/nocompose"
cp "$INSTALL_DIR/install.sh" "$FAKE/install/install.sh"
printf '{ "vendor": "vendora", "displayName": "Vendor A" }\n' > "$FAKE/vendors/vendora/profile.json"
printf '{ "vendor": "vendorb" }\n' > "$FAKE/vendors/vendorb/profile.json"
printf '{ "vendor": "nocompose" }\n' > "$FAKE/vendors/nocompose/profile.json"
: > "$FAKE/vendors/vendora/compose.yml"
: > "$FAKE/vendors/vendorb/compose.yml"
# 目的: 擬似端末から入力を与えて prompt_providers を実行し、選ばれたIDを返す。 入力: 端末へ打ち込む文字列。
prompt_with() {
  printf '%s\n' "$1" | VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE script -qec "sh -c '. $FAKE/install/install.sh; printf \"RESULT=%s\\n\" \"\$(prompt_providers)\"'" /dev/null 2>/dev/null | tr -d '\r' | sed -n 's/^.*RESULT=//p' | tail -n 1
}
have_script() { command -v script >/dev/null 2>&1; }
if have_script; then
  check "対話選択: 番号で選ぶ（複数・区切りはカンマ）" test "$(prompt_with '1,2')" = "vendora,vendorb"
  check "対話選択: 空白区切りも可。順序は入力した順（先頭が既定の選択中になる）" test "$(prompt_with '2 1')" = "vendorb,vendora"
  check "対話選択: 1つだけ選ぶ" test "$(prompt_with '2')" = "vendorb"
  check "対話選択: 範囲外の番号・compose.ymlの無いバンドルは選べない（空になる）" test -z "$(prompt_with '3,9')"
  check "対話選択: 一覧に表示名（displayName。無ければID）が出る" sh -c "printf '1\n' | VPNGW_INSTALL_LIB=1 VPNGW_REPO_ROOT=$FAKE script -qec \"sh -c '. $FAKE/install/install.sh; prompt_providers'\" /dev/null 2>/dev/null | grep -q 'Vendor A'"
else
  echo "SKIP: scriptコマンドが無いため対話選択の検査を省略する"
fi

echo "== 結果: FAIL $FAILS 件"
exit "$FAILS"
