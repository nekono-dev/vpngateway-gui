#!/bin/sh
# 責務: README の単一ノード運用契約を機械的に確認する。
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
temporary_dir=$(mktemp -d)
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM

fail() {
  printf 'README contract failed: %s\n' "$1" >&2
  exit 1
}

section() {
  section_heading=$1
  section_file=$2
  awk -v heading="$section_heading" '$0 == heading {active=1; next} active && /^## / {exit} active {print}' "$section_file"
}

has_order() {
  ordered_text=$1
  first=$2
  second=$3
  first_line=$(printf '%s\n' "$ordered_text" | grep -n -F -m1 -- "$first" | cut -d: -f1 || true)
  second_line=$(printf '%s\n' "$ordered_text" | grep -n -F -m1 -- "$second" | cut -d: -f1 || true)
  [ -n "$first_line" ] && [ -n "$second_line" ] && [ "$first_line" -lt "$second_line" ]
}

check_readme() {
  readme=$1
  contains() {
    grep -Fq -- "$1" "$readme" || fail "README に必要な記述がありません: $1"
  }

  contains 'Debian 12 以降または Ubuntu 22.04 以降'
  contains 'WEB_HTTPS_ENABLED=false'
  contains 'GATEWAY_TLS_ENABLED=false'
  contains '透過ゲートウェイのみ'
  contains '明示的プロキシだけを使う場合、停止時の通信遮断は保証されません'
  contains '旧方式からの移行・互換対応・保存データの引き継ぎには対応しません'
  contains '永続データを削除します。管理者アカウント'
  contains '同意'
  contains '`--yes`'
  contains '自動では元に戻さず'
  contains '撤去しません'
  contains '自動更新せず'
  contains 'docker-compose-plugin'
  contains 'Docker 公式配布元'
  contains 'Gateway の server 証明書・秘密鍵は、すべてこの UID から読める権限'
  if grep -Fq 'Gateway（proxy）は root で動くため' "$readme"; then
    fail 'proxy が root で動く旨の誤記を README に含めないでください'
  fi

  if grep -F 'docker compose pull' "$readme" >/dev/null; then
    fail 'docker compose pull を手順に含めないでください'
  fi
  if grep -E '^[[:space:]]*(sudo[[:space:]]+)?docker compose' "$readme" | grep -Fv 'docker compose -p vpngwgui' >"$temporary_dir/compose-lines"; then
    fail 'docker compose の行に -p vpngwgui がありません'
  fi

  install_section=$(section '## 初回導入' "$readme")
  has_order "$install_section" 'LAN_IFACE' 'host-preparation.sh check' || fail '初回導入節では LAN_IFACE を check より先に案内してください'
  has_order "$install_section" 'host-preparation.sh check' 'host-preparation.sh apply' || fail '初回導入節では check を apply より先に案内してください'
  has_order "$install_section" 'host-preparation.sh apply' 'docker compose -p vpngwgui config --quiet' || fail '初回導入節では apply を config より先に案内してください'
  has_order "$install_section" 'docker compose -p vpngwgui config --quiet' 'docker compose -p vpngwgui up' || fail '初回導入節では config を up より先に案内してください'

  update_section=$(section '## 更新' "$readme")
  printf '%s\n' "$update_section" | grep -Fq 'tar -xzf' || fail '更新節に新しい bundle の展開がありません'
  printf '%s\n' "$update_section" | grep -Fq '.env' || fail '更新節に .env の保持がありません'
  has_order "$update_section" 'host-preparation.sh apply' 'docker compose -p vpngwgui config --quiet' || fail '更新節では apply を config より先に実行してください'
  has_order "$update_section" 'docker compose -p vpngwgui config --quiet' 'docker compose -p vpngwgui up -d --build' || fail '更新節では config を build 更新より先に実行してください'
  if printf '%s\n' "$update_section" | grep -F 'docker compose pull' >/dev/null; then
    fail '更新節に docker compose pull を含めないでください'
  fi

  stop_section=$(section '## 停止と削除' "$readme")
  stop_down_line=$(printf '%s\n' "$stop_section" | grep -n -E -m1 '^[[:space:]]*sudo docker compose -p vpngwgui down[[:space:]]*$' | cut -d: -f1 || true)
  stop_remove_line=$(printf '%s\n' "$stop_section" | grep -n -F -m1 'host-preparation.sh remove' | cut -d: -f1 || true)
  if [ -z "$stop_down_line" ] || [ -z "$stop_remove_line" ] || [ "$stop_down_line" -ge "$stop_remove_line" ]; then
    fail '停止と削除節では Compose down を host-preparation remove より先に実行してください'
  fi

  if grep -Eiq 'vpngwgui-ctl|install\.sh|setup\.sh|bootstrap' "$readme"; then
    fail '旧導入方式のコマンドまたは名称を README に含めないでください'
  fi
}

readme=$repo_root/README.md
check_readme "$readme"

# 契約検査自身が、節単位の順序違反を見逃さないことを確認する。
sed '/sudo docker compose -p vpngwgui down$/d' "$readme" >"$temporary_dir/missing-stop-down.md"
if (check_readme "$temporary_dir/missing-stop-down.md") >/dev/null 2>&1; then
  fail '停止・削除節から down を除いた README を拒否できません'
fi
sed '/sudo compose\/host-preparation.sh apply$/d' "$readme" >"$temporary_dir/missing-update-apply.md"
if (check_readme "$temporary_dir/missing-update-apply.md") >/dev/null 2>&1; then
  fail '更新節から apply を除いた README を拒否できません'
fi
sed '/sudo docker compose -p vpngwgui config --quiet$/d' "$readme" >"$temporary_dir/missing-install-config.md"
if (check_readme "$temporary_dir/missing-install-config.md") >/dev/null 2>&1; then
  fail '初回導入節から config を除いた README を拒否できません'
fi
sed '/同意/d' "$readme" >"$temporary_dir/missing-docker-consent.md"
if (check_readme "$temporary_dir/missing-docker-consent.md") >/dev/null 2>&1; then
  fail 'Docker/Compose 導入の同意説明を除いた README を拒否できません'
fi
sed '/`--yes`/d' "$readme" >"$temporary_dir/missing-yes.md"
if (check_readme "$temporary_dir/missing-yes.md") >/dev/null 2>&1; then
  fail '--yes の説明を除いた README を拒否できません'
fi
sed '/撤去しません/d' "$readme" >"$temporary_dir/missing-remove-contract.md"
if (check_readme "$temporary_dir/missing-remove-contract.md") >/dev/null 2>&1; then
  fail 'remove の Docker 非撤去説明を除いた README を拒否できません'
fi
sed '/自動更新せず/d' "$readme" >"$temporary_dir/missing-os-standard-version.md"
if (check_readme "$temporary_dir/missing-os-standard-version.md") >/dev/null 2>&1; then
  fail 'OS 標準版 Docker の自動更新制約を除いた README を拒否できません'
fi
sed '/docker-compose-plugin/d' "$readme" >"$temporary_dir/missing-debian-12-repository.md"
if (check_readme "$temporary_dir/missing-debian-12-repository.md") >/dev/null 2>&1; then
  fail 'Debian 12 の Compose 導入説明を除いた README を拒否できません'
fi
sed '/自動では元に戻さず/d' "$readme" >"$temporary_dir/missing-no-rollback.md"
if (check_readme "$temporary_dir/missing-no-rollback.md") >/dev/null 2>&1; then
  fail '失敗時の自動 rollback なし説明を除いた README を拒否できません'
fi

sed 's/Gateway の server 証明書・秘密鍵は、すべてこの UID から読める権限/Gateway の server 証明書・秘密鍵に追加の設定は要りません/' "$readme" >"$temporary_dir/missing-gateway-cert-perm.md"
if (check_readme "$temporary_dir/missing-gateway-cert-perm.md") >/dev/null 2>&1; then
  fail 'Gateway 証明書の権限説明を除いた README を拒否できません'
fi

printf '%s\n' 'README contract and negative self-tests: OK'
