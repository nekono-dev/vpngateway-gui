#!/bin/sh
# 責務: boot guard の BLOCK 適用、起動順、有効化確認、所有対象の撤去を検証する
set -eu
umask 022

source_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
tree="$temporary/tree"
mkdir -p "$tree/compose"
cp -R "$source_root/compose/host-preparation" "$tree/compose/host-preparation"
repo="$temporary/repo"
state_dir="$temporary/state"
unit_path="$temporary/systemd/vpngwgui-boot-guard.service"
requires_dir="$temporary/systemd/docker.service.requires"
requires_link="$requires_dir/vpngwgui-boot-guard.service"
rules_path="$temporary/etc/vpngwgui/boot-guard.nft"
mkdir -p "$repo" "$temporary/systemd" "$temporary/etc/vpngwgui"
printf '%s\n' 'LAN_IFACE=eth0' > "$repo/.env"
cat > "$tree/compose/host-preparation/paths.sh" <<EOF
# 責務: boot guard 試験用の隔離パスを定義する
hp_os_release_path='$temporary/os-release'
hp_repo_root='$repo'
hp_state_dir='$state_dir'
hp_docker_daemon_config_path='$temporary/daemon.json'
hp_boot_guard_unit_path='$unit_path'
hp_boot_guard_docker_requires_path='$requires_link'
hp_boot_guard_rules_path='$rules_path'
EOF
printf '%s\n' 'ID=debian' 'VERSION_ID="12"' > "$temporary/os-release"

fixtures="$temporary/bin"
mkdir "$fixtures"
cat > "$fixtures/id" <<'EOF'
#!/bin/sh
[ "$1" = -u ] && { printf '0\n'; exit 0; }
exit 1
EOF
cat > "$fixtures/ip" <<'EOF'
#!/bin/sh
case "$*" in
  'link show dev eth0'|'link show dev eth1') exit 0 ;;
  *) exit 1 ;;
esac
EOF
cat > "$fixtures/nft" <<EOF
#!/bin/sh
printf '%s\\n' "\$*" >> '$temporary/nft.log'
case "\$*" in
  -f\ *)
    batch=\$2
    printf '%s\\n' "\$*" >> '$temporary/nft-batches.log'
    cat "\$batch" >> '$temporary/nft-batches.log'
    if [ -f '$temporary/fail-nft-once' ]; then rm -f '$temporary/fail-nft-once'; exit 1; fi
    iface=\$(sed -n 's/.*iifname "\\([A-Za-z0-9._-][A-Za-z0-9._-]*\\)" drop.*/\\1/p' "\$batch")
    [ -n "\$iface" ] || exit 1
    cat > '$temporary/table.txt' <<TABLE
table inet vpngwgui_guard {
 set healthy_lease4 {
  type ifname
  flags timeout
 }
 chain guard_forward {
  type filter hook forward priority -1; policy accept;
  iifname "\$iface" drop
 }
}
TABLE
    exit 0
    ;;
  'list table inet vpngwgui_guard')
    [ -f '$temporary/table.txt' ] || exit 1
    cat '$temporary/table.txt'
    exit 0
    ;;
  'delete table inet vpngwgui_guard') rm -f '$temporary/table.txt'; exit 0 ;;
  *) exit 1 ;;
esac
EOF
cat > "$fixtures/systemctl" <<EOF
#!/bin/sh
printf '%s\\n' "\$*" >> '$temporary/systemctl.log'
case "\$*" in
  'daemon-reload')
    if [ -f '$temporary/fail-daemon-reload-once' ]; then rm -f '$temporary/fail-daemon-reload-once'; exit 1; fi
    exit 0
    ;;
  'enable vpngwgui-boot-guard.service')
    mkdir -p '$requires_dir'
    ln -sfn '$unit_path' '$requires_link'
    exit 0
    ;;
  'is-enabled vpngwgui-boot-guard.service')
    if [ -f '$temporary/fail-is-enabled-once' ]; then rm -f '$temporary/fail-is-enabled-once'; exit 1; fi
    printf '%s\\n' enabled
    exit 0
    ;;
  'show -p RequiredBy --value vpngwgui-boot-guard.service')
    if [ -f '$temporary/hide-requiredby-once' ]; then rm -f '$temporary/hide-requiredby-once'; exit 0; fi
    [ -L '$requires_link' ] && printf '%s\n' docker.service
    exit 0
    ;;
  'start docker.service')
    [ -L '$requires_link' ] && [ "\$(readlink '$requires_link')" = '$unit_path' ] || exit 1
    [ ! -f '$temporary/fail-boot-guard-activation' ] || exit 1
    : > '$temporary/docker-started'
    exit 0
    ;;
  'disable --now vpngwgui-boot-guard.service') rm -f '$requires_link'; exit 0 ;;
  *) exit 1 ;;
esac
EOF
cat > "$fixtures/stat" <<'EOF'
#!/bin/sh
if [ "$1" = -c ] && [ "$2" = '%u:%g %a' ]; then
  case "$3" in
    TEMP_ROOT|TEMP_ROOT/*)
      printf '0:0 %s\n' "$(/usr/bin/stat -c '%a' "$3")"
      exit 0
      ;;
  esac
fi
exec /usr/bin/stat "$@"
EOF
sed -i "s|TEMP_ROOT|$temporary|g" "$fixtures/stat"
cat > "$fixtures/chown" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$fixtures/rm" <<EOF
#!/bin/sh
printf '%s\\n' "\$*" >> '$temporary/rm.log'
exec /bin/rm "\$@"
EOF
cat > "$fixtures/ln" <<EOF
#!/bin/sh
if [ -f '$temporary/fail-rules-ln-once' ] && [ "\$2" = '$rules_path' ]; then rm -f '$temporary/fail-rules-ln-once'; exit 1; fi
exec /usr/bin/ln "\$@"
EOF
cat > "$fixtures/mv" <<EOF
#!/bin/sh
if [ "\$1" = -f ]; then source=\$2; destination=\$3; else source=\$1; destination=\$2; fi
if [ -f '$temporary/fail-rules-mv-once' ] && [ "\$destination" = '$rules_path' ]; then rm -f '$temporary/fail-rules-mv-once'; exit 1; fi
if [ -f '$temporary/fail-applied-state-mv-once' ] && [ "\$destination" = '$state_dir/state.json' ] && grep -Fq 'applied' "\$source"; then rm -f '$temporary/fail-applied-state-mv-once'; exit 1; fi
exec /usr/bin/mv "\$@"
EOF
chmod +x "$fixtures/id" "$fixtures/ip" "$fixtures/nft" "$fixtures/systemctl" "$fixtures/stat" "$fixtures/chown" "$fixtures/ln" "$fixtures/mv" "$fixtures/rm"
export PATH="$fixtures:/usr/bin:/bin"
HP_BOOT_GUARD_UNIT_PATH="$temporary/attacker-unit"
HP_BOOT_GUARD_RULES_PATH="$temporary/attacker-rules"
export HP_BOOT_GUARD_UNIT_PATH HP_BOOT_GUARD_RULES_PATH

# shellcheck disable=SC1091
. "$tree/compose/host-preparation/paths.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/common.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/state.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/boot-guard.sh"

hp_state_initialize

# nft 適用後の unit 検証失敗でも所有記録を保持し、再実行で BLOCK へ収束する。
: > "$temporary/fail-is-enabled-once"
if hp_apply_boot_guard > "$temporary/partial-apply.out" 2>&1; then
  printf '%s\\n' 'apply unexpectedly succeeded after unit verification failure' >&2
  exit 1
fi
cat "$temporary/partial-apply.out"
[ -f "$temporary/table.txt" ]
grep -Fq '"boot_guard":{"interface":"eth0","status":"pending"}' "$state_dir/state.json" || {
  printf '%s\n' 'RED: nft 成功・unit 確認失敗後に pending 所有記録がありません' >&2
  exit 1
}
hp_apply_boot_guard > "$temporary/retry-apply.out"
grep -Fq '"boot_guard":{"interface":"eth0","status":"applied"}' "$state_dir/state.json"
grep -Fq 'iifname "eth0" drop' "$temporary/table.txt"

hp_apply_boot_guard
[ -f "$unit_path" ]
[ -f "$rules_path" ]
grep -Fq 'After=nftables.service' "$unit_path"
grep -Fq 'DefaultDependencies=no' "$unit_path"
grep -Fq 'After=local-fs.target' "$unit_path"
grep -Fq 'Wants=network-pre.target' "$unit_path"
grep -Fq 'Before=network-pre.target docker.socket docker.service shutdown.target' "$unit_path"
grep -Fq 'Conflicts=shutdown.target' "$unit_path"
# docker.socket より前に置くが、implicit After=basic.target を作らず循環を避ける。
if grep -Eq '^(After|Before)=.*basic\.target' "$unit_path"; then
  printf '%s\n' 'boot guard must not create an ordering edge with basic.target' >&2
  exit 1
fi
verify_boot_guard_ordering_graph() {
  if ! command -v systemd-analyze >/dev/null 2>&1; then
    printf '%s\n' 'SKIP: systemd-analyze がないため boot guard の依存グラフ検証を省略します'
    return 0
  fi

  fixture="$temporary/systemd-ordering-fixture"
  old_fixture="$fixture/old"
  new_fixture="$fixture/new"
  mkdir -p "$old_fixture" "$new_fixture"
  for fixture_dir in "$old_fixture" "$new_fixture"; do
    cat > "$fixture_dir/docker.socket" <<'EOF'
[Unit]
Description=Fixture Docker Socket

[Socket]
ListenStream=/run/docker.sock
EOF
    cat > "$fixture_dir/docker.service" <<'EOF'
[Unit]
Description=Fixture Docker Service
Requires=docker.socket vpngwgui-boot-guard.service
After=docker.socket vpngwgui-boot-guard.service

[Service]
Type=oneshot
ExecStart=/bin/true
EOF
  done

  # 旧本文は boot-guard.sh の既知旧本文定義をそのまま使う。
  hp_boot_guard_unit_legacy_content > "$old_fixture/vpngwgui-boot-guard.service"
  hp_boot_guard_unit_content > "$new_fixture/vpngwgui-boot-guard.service"

  if SYSTEMD_UNIT_PATH="$old_fixture:" systemd-analyze verify docker.service sockets.target basic.target > "$fixture/old.out" 2>&1; then
    printf '%s\n' 'SKIP: 旧本文でも ordering cycle が再現されず、依存グラフ検証を実施できません'
    return 0
  fi
  if ! grep -Fq 'ordering cycle' "$fixture/old.out"; then
    printf '%s\n' 'SKIP: systemd-analyze が旧本文を別の環境要因で検証できません' \
      "$(cat "$fixture/old.out")"
    return 0
  fi

  if ! SYSTEMD_UNIT_PATH="$new_fixture:" systemd-analyze verify docker.service sockets.target basic.target > "$fixture/new.out" 2>&1; then
    if grep -Fq 'ordering cycle' "$fixture/new.out"; then
      printf '%s\n' '新本文でも依存グラフに ordering cycle があります' >&2
      cat "$fixture/new.out" >&2
      return 1
    fi
    printf '%s\n' 'SKIP: systemd-analyze が新本文を環境要因で検証できません' \
      "$(cat "$fixture/new.out")"
    return 0
  fi
}
verify_boot_guard_ordering_graph
grep -Fq 'add table inet vpngwgui_guard' "$rules_path"
grep -Fq 'iifname "eth0" drop' "$rules_path"
grep -Fq '"boot_guard":{"interface":"eth0","status":"applied"}' "$state_dir/state.json"
grep -Fq 'is-enabled vpngwgui-boot-guard.service' "$temporary/systemctl.log"
  grep -Fq 'RequiredBy=docker.service' "$unit_path"
  grep -Fq 'Before=network-pre.target docker.socket docker.service shutdown.target' "$unit_path"
  [ -L "$requires_link" ]
  [ "$(readlink "$requires_link")" = "$unit_path" ]
: > "$temporary/fail-boot-guard-activation"
if systemctl start docker.service; then
  printf '%s\n' 'Docker started although the required boot guard failed' >&2
  exit 1
fi
[ ! -e "$temporary/docker-started" ]
  : > "$temporary/hide-requiredby-once"
  if hp_apply_boot_guard > "$temporary/missing-requiredby.out" 2>&1; then
    printf '%s\n' 'apply succeeded without systemd RequiredBy verification' >&2
    exit 1
  fi
  grep -Fq 'Docker 依存関係を確認できません' "$temporary/missing-requiredby.out"
grep -Fq 'list table inet vpngwgui_guard' "$temporary/nft.log"

# Bootstrap と BLOCK 状態遷移は別の batch であり、起動時は連結して適用する。
bootstrap=$(hp_boot_guard_bootstrap_content eth0)
block=$(hp_boot_guard_block_content eth0)
printf '%s\n' "$bootstrap" | grep -Fqx 'add table inet vpngwgui_guard'
printf '%s\n' "$bootstrap" | grep -Fqx 'add set inet vpngwgui_guard healthy_lease4 { type ifname; flags timeout; }'
printf '%s\n' "$bootstrap" | grep -Fqx 'add chain inet vpngwgui_guard guard_forward { type filter hook forward priority -1; policy accept; }'
if printf '%s\n' "$bootstrap" | grep -Eq 'flush|add rule'; then
  printf '%s\n' 'bootstrap contains state rules' >&2
  exit 1
fi
printf '%s\n' "$block" | grep -Fqx 'flush chain inet vpngwgui_guard guard_forward'
printf '%s\n' "$block" | grep -Fqx 'flush set inet vpngwgui_guard healthy_lease4'
printf '%s\n' "$block" | grep -Fqx 'add rule inet vpngwgui_guard guard_forward iifname "eth0" drop'
expected_batch=$(printf '%s\n%s' "$bootstrap" "$block")
[ "$expected_batch" = "$(hp_boot_guard_apply_content eth0)" ]
printf '%s\n' "$expected_batch" > "$temporary/expected-batch.nft"
cmp "$rules_path" "$temporary/expected-batch.nft"

hp_apply_boot_guard
[ "$(grep -c 'add table inet vpngwgui_guard' "$rules_path")" -eq 1 ]

# 所有記録に一致する systemd unit と nft table だけを撤去する。
hp_remove_boot_guard
[ ! -e "$unit_path" ]
[ ! -e "$requires_link" ]
[ ! -e "$rules_path" ]
grep -Fq 'disable --now vpngwgui-boot-guard.service' "$temporary/systemctl.log"
grep -Fq 'delete table inet vpngwgui_guard' "$temporary/nft.log"
[ ! -e "$temporary/attacker-unit" ]
[ ! -e "$temporary/attacker-rules" ]

# 旧版の所有済み unit は apply で更新し、systemd を再読込する。
hp_apply_boot_guard
hp_boot_guard_unit_legacy_content > "$temporary/legacy-unit"
cp "$temporary/legacy-unit" "$unit_path"
reload_count_before=$(grep -c '^daemon-reload$' "$temporary/systemctl.log")
hp_apply_boot_guard
grep -Fq 'DefaultDependencies=no' "$unit_path"
reload_count_after=$(grep -c '^daemon-reload$' "$temporary/systemctl.log")
[ "$reload_count_after" -gt "$reload_count_before" ]
hp_remove_boot_guard
[ ! -e "$unit_path" ]
[ ! -e "$requires_link" ]
[ ! -e "$rules_path" ]

# apply は未所有または変更済みの object を nft 書き込み前に拒否する。
write_state_iface() {
  iface=$1
  printf '{"version":1,"boot_guard":{"interface":"%s","status":"applied"}}\n' "$iface" > "$state_dir/state.json"
  chmod 0600 "$state_dir/state.json"
}
write_table_iface() {
  iface=$1
  {
    printf '%s\n' 'table inet vpngwgui_guard {' ' set healthy_lease4 {' '  type ifname' '  flags timeout' ' }' ' chain guard_forward {' '  type filter hook forward priority -1; policy accept;'
    printf '  iifname "%s" drop\n' "$iface"
    printf '%s\n' ' }' '}'
  } > "$temporary/table.txt"
}
write_lease_table() {
  iface=$1
  format=$2
  {
    printf '%s\n' 'table inet vpngwgui_guard {' ' set healthy_lease4 {' '  type ifname' '  flags timeout'
    case "$format" in
      no-expiry) printf '  elements = { "%s" timeout 4s }\n' "$iface" ;;
      expiry-seconds) printf '  elements = { "%s" timeout 4s expires 3s }\n' "$iface" ;;
      expiry-mixed) printf '  elements = { "%s" timeout 4s expires 2s347ms }\n' "$iface" ;;
      expiry-millis) printf '  elements = { "%s" timeout 4s expires 500ms }\n' "$iface" ;;
      expiry-minute) printf '  elements = { "%s" timeout 4s expires 1m }\n' "$iface" ;;
      expiry-wrapped)
        printf '%s\n' '  elements = {'
        printf '    "%s"    timeout   4s    expires   2s347ms\n' "$iface"
        printf '%s\n' '  }'
        ;;
      wrong-interface) printf '  elements = { "eth9" timeout 4s expires 2s }\n' ;;
      wrong-timeout) printf '  elements = { "%s" timeout 10s expires 2s }\n' "$iface" ;;
      extra-element) printf '  elements = { "%s" timeout 4s, "eth9" timeout 4s }\n' "$iface" ;;
    esac
    printf '%s\n' ' }' ' chain guard_forward {' '  type filter hook forward priority filter - 1; policy accept;' '  iifname @healthy_lease4 return'
    printf '  iifname "%s" drop\n' "$iface"
    printf '%s\n' ' }' '}'
  } > "$temporary/table.txt"
}

# remove は boot guard unit を指す製品所有リンクだけを削除する。
write_state_iface eth0
hp_boot_guard_install_file "$unit_path" 644 hp_boot_guard_unit_content
mkdir -p "$requires_dir"
ln -s "$unit_path" "$requires_link"
foreign_target="$temporary/foreign-unit.service"
printf '%s\n' 'foreign unit' > "$foreign_target"
ln -s "$foreign_target" "$requires_dir/foreign.service"
write_table_iface eth0
hp_remove_boot_guard
[ ! -e "$requires_link" ]
[ -L "$requires_dir/foreign.service" ]
[ "$(readlink "$requires_dir/foreign.service")" = "$foreign_target" ]

# 同じ管理先にある外部リンクは保持し、unit を削除しない。
write_state_iface eth0
hp_boot_guard_install_file "$unit_path" 644 hp_boot_guard_unit_content
ln -s "$foreign_target" "$requires_link"
write_table_iface eth0
if hp_remove_boot_guard > "$temporary/remove-foreign-link.out" 2>&1; then
  printf '%s\n' 'remove accepted a foreign Docker requires symlink' >&2
  exit 1
fi
[ -L "$requires_link" ]
[ "$(readlink "$requires_link")" = "$foreign_target" ]
[ -f "$unit_path" ]
rm -f "$unit_path"
if hp_remove_boot_guard > "$temporary/remove-foreign-link-without-unit.out" 2>&1; then
  printf '%s\n' 'remove accepted a foreign Docker requires symlink without the unit file' >&2
  exit 1
fi
[ -L "$requires_link" ]
[ "$(readlink "$requires_link")" = "$foreign_target" ]
rm -f "$requires_link"
hp_remove_boot_guard
: > "$temporary/nft.log"
: > "$temporary/nft-batches.log"
for conflict in extra-rule extra-chain extra-set other-interface wrong-hook wrong-policy wrong-priority; do
  write_state_iface eth0
  write_table_iface eth0
  case "$conflict" in
    extra-rule)
      awk '{ print; if ($0 ~ /iifname "eth0" drop/) print "  counter packets 0 bytes 0" }' "$temporary/table.txt" > "$temporary/table.changed"
      mv "$temporary/table.changed" "$temporary/table.txt"
      ;;
    extra-chain)
      sed '$d' "$temporary/table.txt" > "$temporary/table.changed"
      printf '%s\n' ' chain foreign { }' '}' >> "$temporary/table.changed"
      mv "$temporary/table.changed" "$temporary/table.txt"
      ;;
    extra-set)
      sed '/ chain guard_forward/i\ set foreign { type ifname; }' "$temporary/table.txt" > "$temporary/table.changed"
      mv "$temporary/table.changed" "$temporary/table.txt"
      ;;
    other-interface)
      awk '{ print; if ($0 ~ /iifname "eth0" drop/) print "  iifname \"eth9\" drop" }' "$temporary/table.txt" > "$temporary/table.changed"
      mv "$temporary/table.changed" "$temporary/table.txt"
      ;;
    wrong-hook)
      sed 's/hook forward/hook input/' "$temporary/table.txt" > "$temporary/table.changed"
      mv "$temporary/table.changed" "$temporary/table.txt"
      ;;
    wrong-policy)
      sed 's/policy accept/policy drop/' "$temporary/table.txt" > "$temporary/table.changed"
      mv "$temporary/table.changed" "$temporary/table.txt"
      ;;
    wrong-priority)
      sed 's/priority -1;/priority 0;/' "$temporary/table.txt" > "$temporary/table.changed"
      mv "$temporary/table.changed" "$temporary/table.txt"
      ;;
  esac
  cp "$temporary/table.txt" "$temporary/table.before"
  cp "$state_dir/state.json" "$temporary/state.before"
  : > "$temporary/nft.log"
  if hp_apply_boot_guard > "$temporary/apply-$conflict.out" 2>&1; then
    printf 'apply accepted unowned %s\n' "$conflict" >&2
    exit 1
  fi
  grep -Fq '競合' "$temporary/apply-$conflict.out"
  if grep -Eq '(^| )-f( |$)|flush|add rule|add table|add set|add chain' "$temporary/nft.log"; then
    printf 'apply wrote to nft before rejecting unowned %s\n' "$conflict" >&2
    cat "$temporary/nft.log" >&2
    exit 1
  fi
  cmp "$temporary/table.before" "$temporary/table.txt"
  cmp "$temporary/state.before" "$state_dir/state.json"
  [ "$(hp_boot_guard_recorded_iface)" = eth0 ]
done

# 記録済み interface と一致する既知の BLOCK / LEASE / OFF 形式を受け入れる。
for state in block lease off; do
  write_state_iface eth0
  case "$state" in
    block) write_table_iface eth0 ;;
    lease)
      write_table_iface eth0
      sed -i '/flags timeout/a\  elements = { "eth0" timeout 4s expires 2s347ms }' "$temporary/table.txt"
      sed -i '/iifname "eth0" drop/i\  iifname @healthy_lease4 return' "$temporary/table.txt"
      sed -i 's/priority -1/priority filter - 1/' "$temporary/table.txt"
      ;;
    off)
      write_table_iface eth0
      sed -i '/iifname "eth0" drop/d' "$temporary/table.txt"
      ;;
  esac
  : > "$temporary/nft.log"
  hp_apply_boot_guard > "$temporary/apply-owned-$state.out"
  grep -Fq 'iifname "eth0" drop' "$temporary/table.txt"
  grep -Fq 'flush chain inet vpngwgui_guard guard_forward' "$temporary/nft-batches.log"
done

# nftables の lease 残時間表示は複数の時間表記・改行・空白でも所有状態として扱う。
for format in no-expiry expiry-seconds expiry-mixed expiry-millis expiry-minute expiry-wrapped; do
  write_state_iface eth0
  write_lease_table eth0 "$format"
  hp_apply_boot_guard > "$temporary/apply-lease-$format.out"
  grep -Fq 'iifname "eth0" drop' "$temporary/table.txt"
done

# interface、timeout、element 数が異なる lease table は apply が変更前に拒否する。
for format in wrong-interface wrong-timeout extra-element; do
  write_state_iface eth0
  write_lease_table eth0 "$format"
  cp "$temporary/table.txt" "$temporary/table-lease-conflict.before"
  : > "$temporary/nft.log"
  if hp_apply_boot_guard > "$temporary/apply-lease-$format.out" 2>&1; then
    printf 'apply accepted invalid lease element: %s\n' "$format" >&2
    exit 1
  fi
  grep -Fq '競合' "$temporary/apply-lease-$format.out"
  if grep -Eq '(^| )-f( |$)|flush|add rule|add table|add set|add chain' "$temporary/nft.log"; then
    printf 'apply wrote to nft before rejecting lease conflict: %s\n' "$format" >&2
    exit 1
  fi
  cmp "$temporary/table-lease-conflict.before" "$temporary/table.txt"
done

# LAN_IFACE 変更時は旧所有状態を検査後、新しい BLOCK へ原子的に置き換える。
write_state_iface eth0
write_table_iface eth0
printf '%s\n' 'LAN_IFACE=eth1' > "$repo/.env"
: > "$temporary/nft.log"
: > "$temporary/nft-batches.log"
hp_apply_boot_guard > "$temporary/apply-changed-iface.out"
grep -Fq 'iifname "eth1" drop' "$temporary/table.txt"
grep -Fq 'iifname "eth1" drop' "$temporary/nft-batches.log"
if grep -Fq 'iifname "eth0" drop' "$temporary/table.txt"; then
  printf '%s\n' '変更前の interface rule が残っています' >&2
  exit 1
fi
[ "$(hp_boot_guard_recorded_iface)" = eth1 ]
grep -Fq 'flush chain inet vpngwgui_guard guard_forward' "$temporary/nft-batches.log"

run_recovery_case() {
  scenario=$1
  failure=$2
  rm -rf "$state_dir"
  rm -f "$unit_path" "$rules_path" "$temporary/table.txt"
  : > "$temporary/nft.log"
  : > "$temporary/nft-batches.log"
  if [ "$scenario" = change ]; then
    hp_state_initialize
    write_state_iface eth0
    write_table_iface eth0
    hp_boot_guard_apply_content eth0 > "$rules_path"
    chmod 0600 "$rules_path"
    printf '%s\n' 'LAN_IFACE=eth1' > "$repo/.env"
    target=eth1
  else
    printf '%s\n' 'LAN_IFACE=eth0' > "$repo/.env"
    target=eth0
  fi
  case "$failure" in
    after-pending)
      if [ "$scenario" = change ]; then : > "$temporary/fail-rules-mv-once"; else : > "$temporary/fail-rules-ln-once"; fi
      ;;
    after-rules) : > "$temporary/fail-daemon-reload-once" ;;
    after-systemd-enable) : > "$temporary/fail-nft-once" ;;
    after-nft-apply) : > "$temporary/fail-is-enabled-once" ;;
    after-verification) : > "$temporary/fail-applied-state-mv-once" ;;
  esac
  if hp_apply_boot_guard > "$temporary/$scenario-$failure-first.out" 2>&1; then
    printf 'apply unexpectedly succeeded: %s/%s\n' "$scenario" "$failure" >&2
    exit 1
  fi
  if [ ! -f "$state_dir/state.json" ]; then cat "$temporary/$scenario-$failure-first.out" >&2; fi
  if [ "$scenario" = change ]; then
    grep -Fq '"interface":"eth1","previous_interface":"eth0","status":"pending"' "$state_dir/state.json"
  else
    grep -Fq '"interface":"eth0","status":"pending"' "$state_dir/state.json"
  fi
  hp_apply_boot_guard > "$temporary/$scenario-$failure-retry.out"
  grep -Fq "iifname \"$target\" drop" "$temporary/table.txt"
  grep -Fq "iifname \"$target\" drop" "$rules_path"
  grep -Fq "\"interface\":\"$target\",\"status\":\"applied\"" "$state_dir/state.json"
  [ "$(grep -c "iifname \"$target\" drop" "$temporary/table.txt")" -eq 1 ]
}

# 初回設置と interface 変更で、各 apply 副作用の直後の失敗から retry 収束する。
for scenario in first-install change; do
  for failure in after-pending after-rules after-nft-apply after-systemd-enable after-verification; do
    (run_recovery_case "$scenario" "$failure")
  done
done

# pending interface change の nft 前失敗でも、前 interface に残る所有 table を撤去する。
rm -rf "$state_dir"
rm -f "$unit_path" "$rules_path" "$temporary/table.txt"
printf '%s\n' 'LAN_IFACE=eth0' > "$repo/.env"
hp_state_initialize
hp_apply_boot_guard > "$temporary/remove-pending-setup.out"
printf '%s\n' 'LAN_IFACE=eth1' > "$repo/.env"
: > "$temporary/fail-rules-mv-once"
if hp_apply_boot_guard > "$temporary/remove-pending-failure.out" 2>&1; then
  printf '%s\\n' 'interface-change apply unexpectedly succeeded before nft failure injection' >&2
  exit 1
fi
grep -Fq '"interface":"eth1","previous_interface":"eth0","status":"pending"' "$state_dir/state.json"
grep -Fq 'iifname "eth0" drop' "$temporary/table.txt"
: > "$temporary/systemctl.log"
: > "$temporary/nft.log"
: > "$temporary/rm.log"
hp_remove_boot_guard > "$temporary/remove-pending.out"
[ ! -e "$temporary/table.txt" ]
[ ! -e "$unit_path" ]
[ ! -e "$requires_link" ]
[ ! -e "$rules_path" ]
grep -Fq 'disable --now vpngwgui-boot-guard.service' "$temporary/systemctl.log"
grep -Fq 'delete table inet vpngwgui_guard' "$temporary/nft.log"

# table に foreign rule があれば全 ownership 検査を先に済ませ、何も撤去しない。
write_state_iface eth0
hp_boot_guard_install_file "$unit_path" 644 hp_boot_guard_unit_content
mkdir -p "$requires_dir"
ln -sfn "$unit_path" "$requires_link"
hp_boot_guard_apply_content eth0 > "$rules_path"
chmod 0600 "$rules_path"
write_table_iface eth0
printf '%s\n' '  counter packets 0 bytes 0' >> "$temporary/table.txt"
cp "$unit_path" "$temporary/unit-conflict.before"
cp "$rules_path" "$temporary/rules-conflict.before"
cp "$temporary/table.txt" "$temporary/table-conflict.before"
: > "$temporary/systemctl.log"
: > "$temporary/nft.log"
: > "$temporary/rm.log"
if hp_remove_boot_guard > "$temporary/remove-table-conflict.out" 2>&1; then
  printf '%s\n' 'remove accepted a table containing a foreign rule' >&2
  exit 1
fi
cmp "$temporary/unit-conflict.before" "$unit_path"
cmp "$temporary/rules-conflict.before" "$rules_path"
cmp "$temporary/table-conflict.before" "$temporary/table.txt"
[ -L "$requires_link" ] && [ "$(readlink "$requires_link")" = "$unit_path" ]
if grep -Fq 'disable --now' "$temporary/systemctl.log" || grep -Fq 'delete table' "$temporary/nft.log" ||
  [ -s "$temporary/rm.log" ] ||
  grep -F "$unit_path" "$temporary/rm.log" || grep -F "$requires_link" "$temporary/rm.log" ||
  grep -F "$rules_path" "$temporary/rm.log"; then
  printf '%s\n' 'remove issued a destructive command before rejecting the table conflict' >&2
  exit 1
fi

# 所有記録がない既存 table は変更しない。
rm -f "$state_dir/state.json"
write_table_iface eth1
: > "$temporary/table.before"
cp "$temporary/table.txt" "$temporary/table.before"
: > "$temporary/nft.log"
if hp_apply_boot_guard > "$temporary/apply-no-state.out" 2>&1; then
  printf '%s\n' 'apply accepted existing table without an ownership record' >&2
  exit 1
fi
grep -Fq '競合' "$temporary/apply-no-state.out"
[ ! -e "$state_dir/state.json" ]
cmp "$temporary/table.before" "$temporary/table.txt"
if grep -Eq '(^| )-f( |$)|flush|add rule|add table|add set|add chain' "$temporary/nft.log"; then
  printf '%s\n' 'apply wrote to unowned table without state' >&2
  exit 1
fi
# remove は BLOCK / LEASE / OFF の既知内容だけを削除し、外部差分は保持して競合にする。
write_state_iface eth1
hp_boot_guard_apply_content eth1 > "$rules_path"
chmod 0600 "$rules_path"
for state in block lease off; do
  {
    printf '%s\n' 'table inet vpngwgui_guard {' ' set healthy_lease4 {' '  type ifname' '  flags timeout'
    if [ "$state" = lease ]; then printf '%s\n' '  elements = { "eth1" timeout 4s }'; fi
    printf '%s\n' ' }' ' chain guard_forward {'
    if [ "$state" = lease ]; then
      printf '%s\n' '  type filter hook forward priority filter - 1; policy accept;'
    else
      printf '%s\n' '  type filter hook forward priority -1; policy accept;'
    fi
    case "$state" in
      block) printf '%s\n' '  iifname "eth1" drop' ;;
      lease) printf '%s\n' '  iifname @healthy_lease4 return' '  iifname "eth1" drop' ;;
    esac
    printf '%s\n' ' }' '}'
  } > "$temporary/table.txt"
  hp_remove_boot_guard
  [ ! -e "$temporary/table.txt" ] || { printf 'owned %s table was retained\n' "$state" >&2; exit 1; }
done
for conflict in extra-chain extra-set extra-rule different-interface; do
  case "$conflict" in
    extra-chain) extra=' chain foreign { }' ;;
    extra-set) extra=' set foreign { type ifname; }' ;;
    extra-rule) extra='  counter packets 0 bytes 0' ;;
    different-interface) extra='  iifname "eth9" drop' ;;
  esac
  {
    printf '%s\n' 'table inet vpngwgui_guard {' ' set healthy_lease4 {' '  type ifname' '  flags timeout' ' }'
    if [ "$conflict" = extra-set ]; then printf '%s\n' "$extra"; fi
    printf '%s\n' ' chain guard_forward {' '  type filter hook forward priority -1; policy accept;'
    if [ "$conflict" = different-interface ]; then
      printf '%s\n' '  iifname "eth9" drop'
    else
      printf '%s\n' '  iifname "eth0" drop'
      if [ "$conflict" != extra-set ]; then printf '%s\n' "$extra"; fi
    fi
    printf '%s\n' ' }' '}'
  } > "$temporary/table.txt"
  if hp_remove_boot_guard > "$temporary/remove-$conflict.out" 2>&1; then
    printf 'remove accepted conflicting %s table\n' "$conflict" >&2
    exit 1
  fi
  [ -f "$temporary/table.txt" ] || { printf 'remove deleted conflicting %s table\n' "$conflict" >&2; exit 1; }
  grep -Fq '競合' "$temporary/remove-$conflict.out"
done

# remove も expires 表示あり・なしの lease を受け入れ、異なる element は保持する。
for format in no-expiry expiry-seconds expiry-mixed expiry-millis expiry-minute expiry-wrapped; do
  write_state_iface eth1
  hp_boot_guard_apply_content eth1 > "$rules_path"
  chmod 0600 "$rules_path"
  write_lease_table eth1 "$format"
  hp_remove_boot_guard
  [ ! -e "$temporary/table.txt" ] || { printf 'remove retained owned lease: %s\n' "$format" >&2; exit 1; }
done
for format in wrong-interface wrong-timeout extra-element; do
  write_state_iface eth1
  hp_boot_guard_apply_content eth1 > "$rules_path"
  chmod 0600 "$rules_path"
  write_lease_table eth1 "$format"
  cp "$temporary/table.txt" "$temporary/table-lease-remove-conflict.before"
  : > "$temporary/systemctl.log"
  : > "$temporary/nft.log"
  : > "$temporary/rm.log"
  if hp_remove_boot_guard > "$temporary/remove-lease-$format.out" 2>&1; then
    printf 'remove accepted invalid lease element: %s\n' "$format" >&2
    exit 1
  fi
  grep -Fq '競合' "$temporary/remove-lease-$format.out"
  cmp "$temporary/table-lease-remove-conflict.before" "$temporary/table.txt"
  if grep -Fq 'disable --now' "$temporary/systemctl.log" || grep -Fq 'delete table' "$temporary/nft.log"; then
    printf 'remove changed host resources before rejecting lease conflict: %s\n' "$format" >&2
    exit 1
  fi
  [ ! -s "$temporary/rm.log" ]
done

# 製品所有ファイルが symlink に置換された場合は、参照先に触れず apply を拒否する。
rm -f "$temporary/table.txt"
target="$temporary/untouched-unit"
printf '%s\n' 'unrelated unit' > "$target"
ln -s "$target" "$unit_path"
if hp_apply_boot_guard > "$temporary/symlink.out" 2>&1; then
  printf '%s\n' 'apply accepted a symlink boot guard unit' >&2
  exit 1
fi
[ "$(cat "$target")" = 'unrelated unit' ]
grep -Fq 'boot guard file が symlink です' "$temporary/symlink.out"

# apply は RequiredBy directory の symlink を辿らず、enable 前に拒否する。
rm -f "$unit_path"
foreign_requires_directory="$temporary/foreign-requires-directory"
mkdir -m 0755 "$foreign_requires_directory"
rm -f "$requires_dir/foreign.service" "$requires_dir/foreign-requires-directory"
rmdir "$requires_dir"
ln -s "$foreign_requires_directory" "$requires_dir"
if hp_apply_boot_guard > "$temporary/requires-directory-symlink.out" 2>&1; then
  printf '%s\n' 'apply accepted a symlink Docker requires directory' >&2
  exit 1
fi
[ ! -e "$foreign_requires_directory/vpngwgui-boot-guard.service" ]
grep -Fq 'Docker requires directory が安全ではありません' "$temporary/requires-directory-symlink.out"

# apply は別の unit を指す dependency symlink を上書きしない。
rm -f "$requires_dir"
mkdir -m 0755 "$requires_dir"
foreign_dependency_target="$temporary/foreign-dependency.service"
printf '%s\n' 'foreign dependency' > "$foreign_dependency_target"
ln -s "$foreign_dependency_target" "$requires_link"
if hp_apply_boot_guard > "$temporary/foreign-dependency.out" 2>&1; then
  printf '%s\n' 'apply accepted a foreign Docker dependency symlink' >&2
  exit 1
fi
[ -L "$requires_link" ]
[ "$(readlink "$requires_link")" = "$foreign_dependency_target" ]
[ "$(cat "$foreign_dependency_target")" = 'foreign dependency' ]
grep -Fq 'Docker dependency link が外部所有のため保持します' "$temporary/foreign-dependency.out"

# nft 1.0.9 の実出力を BLOCK/LEASE/更新済み LEASE/OFF それぞれで検証する。
real_listing_dir="$tree/compose/host-preparation/tests/fixtures/nft-1.0.9"
for real_state in block lease lease-refreshed off; do
  cp "$real_listing_dir/$real_state.txt" "$temporary/table.txt"
  table_output=$(nft list table inet vpngwgui_guard)
  hp_boot_guard_verify_resources
  hp_boot_guard_verify_owned_table acclan0 || {
    printf 'RED: real nft 1.0.9 %s listing was rejected\n' "$real_state" >&2
    exit 1
  }
done

printf '%s\n' 'host-preparation boot guard cases passed'
