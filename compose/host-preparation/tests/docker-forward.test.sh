#!/bin/sh
# 責務: Docker daemon forwarding 設定の適用・競合・状態表示・解除を隔離環境で検証する
# shellcheck disable=SC2154
set -eu

source_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
tree="$temporary/tree"
mkdir -p "$tree/compose"
cp "$source_root/compose/host-preparation.sh" "$tree/compose/host-preparation.sh"
cp -R "$source_root/compose/host-preparation" "$tree/compose/host-preparation"
state_dir="$temporary/state"
daemon_dir="$temporary/docker"
mkdir -p "$state_dir" "$daemon_dir"
chmod 700 "$state_dir"
fixtures="$temporary/bin"
mkdir "$fixtures"
policy_file="$temporary/policy"
version_file="$temporary/version"
restart_log="$temporary/restarts"
printf '28.0.0\n' > "$version_file"
printf 'DROP\n' > "$policy_file"
cat > "$tree/compose/host-preparation/paths.sh" <<EOF
# 責務: Docker forwarding 試験用の隔離パスを定義する
hp_state_dir='$state_dir'
hp_docker_daemon_config_path='$daemon_dir/daemon.json'
EOF
cat > "$fixtures/id" <<'EOF'
#!/bin/sh
[ "$1" = -u ] && { printf '0\n'; exit 0; }
exit 1
EOF
cat > "$fixtures/stat" <<EOF
#!/bin/sh
if [ "\$1" = -c ] && [ "\$2" = '%u:%g %a' ]; then
  case "\$3" in '$state_dir'|'$state_dir'/*|'$daemon_dir'/*) printf '0:0 %s\n' \$(/usr/bin/stat -c '%a' "\$3"); exit 0 ;; esac
fi
exec /usr/bin/stat "\$@"
EOF
cat > "$fixtures/docker" <<EOF
#!/bin/sh
[ "\$1" = version ] || exit 1
cat '$version_file'
EOF
cat > "$fixtures/iptables" <<EOF
#!/bin/sh
[ "\$1 \$2" = '-S FORWARD' ] || exit 1
printf '%s\n' "-P FORWARD \$(cat '$policy_file')"
EOF
cat > "$fixtures/nft" <<EOF
#!/bin/sh
exit 1
EOF
cat > "$fixtures/systemctl" <<EOF
#!/bin/sh
case "\$1" in
  restart) [ "\$2" = docker ] || exit 1; printf 'restart\n' >> '$restart_log'; case "\$(cat '$temporary/restart-mode' 2>/dev/null || :)" in fail) exit 1 ;; keepdrop) : ;; unknown) printf 'unknown\n' > '$policy_file' ;; *) printf 'ACCEPT\n' > '$policy_file' ;; esac ;;
  is-active) [ "\$2 \$3" = '--quiet docker' ] ;;
  *) exit 1 ;;
esac
EOF
cat > "$fixtures/sleep" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$fixtures"/*
export PATH="$fixtures:/usr/bin:/bin"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/paths.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/state.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/docker-forward.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/status.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/remove.sh"

hp_apply_docker_forward > "$temporary/absent.out"
cmp -s "$hp_docker_daemon_config_path" <<'EOF'
{"ip-forward-no-drop": true}
EOF
[ "$(stat -c '%a' "$hp_docker_daemon_config_path")" = 644 ]
[ "$(cat "$restart_log")" = restart ]
[ "$(hp_docker_forward_recorded_status)" = applied ]

# 再適用は Docker を再起動しない。
hp_apply_docker_forward >/dev/null
[ "$(wc -l < "$restart_log")" -eq 1 ]

# ABSENT + ACCEPT でも設定を作成し、再起動後の ACCEPT 確認を経て applied にする。
rm -f "$hp_state_path" "$hp_docker_daemon_config_path"
printf 'ACCEPT\n' > "$policy_file"
before=$(wc -l < "$restart_log")
hp_apply_docker_forward > "$temporary/absent-accept.out"
[ -f "$hp_docker_daemon_config_path" ]
[ "$(wc -l < "$restart_log")" -eq $((before + 1)) ]
[ "$(hp_docker_forward_recorded_status)" = applied ]

# 再起動失敗では pending を残し、再実行で再起動して applied に回復する。
rm -f "$hp_state_path" "$hp_docker_daemon_config_path"
printf 'DROP\n' > "$policy_file"
printf 'fail\n' > "$temporary/restart-mode"
before=$(wc -l < "$restart_log")
if hp_apply_docker_forward > "$temporary/restart-fail.out" 2>&1; then exit 1; fi
[ "$(wc -l < "$restart_log")" -eq $((before + 1)) ]
[ "$(hp_docker_forward_recorded_status)" = pending ]
printf 'ACCEPT\n' > "$policy_file"
rm -f "$temporary/restart-mode"
hp_apply_docker_forward > "$temporary/pending-retry.out"
[ "$(wc -l < "$restart_log")" -eq $((before + 2)) ]
[ "$(hp_docker_forward_recorded_status)" = applied ]

# OWNED でも policy を確認できなければ、ファイルと Docker を変更しない。
printf '%s\n' '{"ip-forward-no-drop": true}' > "$hp_docker_daemon_config_path"
hp_docker_forward_record applied
before=$(wc -l < "$restart_log")
printf 'unknown\n' > "$policy_file"
if hp_apply_docker_forward > "$temporary/unknown-before.out" 2>&1; then exit 1; fi
grep -Fq 'FORWARD policy を確認できません' "$temporary/unknown-before.out"
cmp -s "$hp_docker_daemon_config_path" <<'EOF'
{"ip-forward-no-drop": true}
EOF
[ "$(wc -l < "$restart_log")" -eq "$before" ]

# ACCEPT なら OWNED 設定は変更不要で、Docker を再起動しない。
printf 'ACCEPT\n' > "$policy_file"
hp_apply_docker_forward > "$temporary/accept.out"
grep -Fq '変更不要' "$temporary/accept.out"
[ "$(wc -l < "$restart_log")" -eq "$before" ]

# OWNED + pending + ACCEPT は再起動を再試行し、成功後に applied へ更新する。
hp_docker_forward_record pending
before=$(wc -l < "$restart_log")
hp_apply_docker_forward > "$temporary/owned-pending-accept.out"
[ "$(wc -l < "$restart_log")" -eq $((before + 1)) ]
[ "$(hp_docker_forward_recorded_status)" = applied ]

# PENDING-CLEANABLE + ACCEPT は欠落した所有ファイルを再作成して再起動し、applied にする。
# ABSENT + ACCEPT の既存ケースとは異なり、pending 記録が残った復旧状態を明示する。
rm -f "$hp_docker_daemon_config_path"
hp_docker_forward_record pending
before=$(wc -l < "$restart_log")
hp_apply_docker_forward > "$temporary/pending-cleanable-accept.out"
cmp -s "$hp_docker_daemon_config_path" <<'EOF'
{"ip-forward-no-drop": true}
EOF
[ "$(wc -l < "$restart_log")" -eq $((before + 1)) ]
[ "$(hp_docker_forward_recorded_status)" = applied ]

# 再起動後も DROP が残れば失敗し、所有 state は applied にしない。
rm -f "$hp_state_path" "$hp_docker_daemon_config_path"
printf 'DROP\n' > "$policy_file"
printf 'keepdrop\n' > "$temporary/restart-mode"
if hp_apply_docker_forward > "$temporary/drop.out" 2>&1; then exit 1; fi
grep -Fq 'FORWARD policy が ACCEPT ではありません（DROP）' "$temporary/drop.out"
[ "$(hp_docker_forward_recorded_status)" = pending ]
rm -f "$temporary/restart-mode"

# 再起動後に policy を確認できない場合も失敗し、pending を保持する。
rm -f "$hp_state_path" "$hp_docker_daemon_config_path"
printf 'DROP\n' > "$policy_file"
printf 'unknown\n' > "$temporary/restart-mode"
if hp_apply_docker_forward > "$temporary/restart-unknown.out" 2>&1; then exit 1; fi
grep -Fq 'policy が ACCEPT ではありません（unknown）' "$temporary/restart-unknown.out"
[ "$(hp_docker_forward_recorded_status)" = pending ]
rm -f "$temporary/restart-mode"

# 外部設定済みなら DROP 時は再起動だけ行い、所有 state を作らない。
rm -f "$hp_state_path"
printf '%s\n' '{"other": 1, "ip-forward-no-drop": true}' > "$hp_docker_daemon_config_path"
printf 'DROP\n' > "$policy_file"
before=$(wc -l < "$restart_log")
hp_apply_docker_forward >/dev/null
[ "$(wc -l < "$restart_log")" -eq $((before + 1)) ]
[ ! -e "$hp_state_path" ]

# ALREADY-SET + ACCEPT は変更しない。
printf 'ACCEPT\n' > "$policy_file"
before=$(wc -l < "$restart_log")
hp_apply_docker_forward >/dev/null
[ "$(wc -l < "$restart_log")" -eq "$before" ]

# CONFLICT はファイルもサービスも変更しない。
printf '%s\n' '{"other": 1}' > "$hp_docker_daemon_config_path"
if hp_apply_docker_forward > "$temporary/conflict.out" 2>&1; then exit 1; fi
grep -Fq '手動追加' "$temporary/conflict.out"
[ "$(wc -l < "$restart_log")" -eq "$before" ]

# 古い daemon は check/apply とも拒否する。
printf '27.5.1\n' > "$version_file"
if hp_check_docker_forward > "$temporary/old.out" 2>&1; then exit 1; fi
grep -Fq 'Docker 28 以降' "$temporary/old.out"
if hp_apply_docker_forward >/dev/null 2>&1; then exit 1; fi
printf '28.0.0\n' > "$version_file"

# ALREADY-SET の競合なし status、OWNED の remove、変更済み remove、ABSENT remove。
rm -f "$hp_docker_daemon_config_path"
printf 'DROP\n' > "$policy_file"
hp_apply_docker_forward >/dev/null
hp_status > "$temporary/status.out"
grep -Fq 'Docker daemon.json: OWNED' "$temporary/status.out"
grep -Fq 'Docker FORWARD policy: ACCEPT' "$temporary/status.out"
hp_remove_docker_forward
[ ! -e "$hp_docker_daemon_config_path" ]
hp_remove_docker_forward
hp_docker_forward_record pending
printf '%s\n' '{"modified": true, "ip-forward-no-drop": true}' > "$hp_docker_daemon_config_path"
[ "$(hp_docker_forward_preflight | head -n 1)" != OWNED ]
if hp_remove_docker_forward >/dev/null 2>&1; then exit 1; fi
[ "$(cat "$hp_docker_daemon_config_path")" = '{"modified": true, "ip-forward-no-drop": true}' ]
rm -f "$hp_docker_daemon_config_path"
hp_remove_docker_forward

# 既存の外国設定は check で衝突として報告する。
printf '%s\n' '{"foreign": true}' > "$hp_docker_daemon_config_path"
if hp_check_docker_forward > "$temporary/check-conflict.out" 2>&1; then exit 1; fi
grep -Fq 'daemon.json: CONFLICT' "$temporary/check-conflict.out"

printf '%s\n' 'host-preparation docker-forward cases passed'
