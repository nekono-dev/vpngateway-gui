#!/usr/bin/env bash
# 8.5 製品外設定の不変更: host-preparation の apply と remove の前後で、/etc・/usr/local の全ファイルの内容と権限、
# sysctl（net.*）、nft の table 一覧を記録し、apply が変えたもの・remove 後に残る差分を列挙する。
# 期待: apply が変えるのは製品の所有物（/etc/vpngwgui・/etc/sysctl.d の製品ファイル・製品 unit とその依存 symlink・/etc/docker/daemon.json）と
# 製品の sysctl・guard table だけで、remove 後は apply 前と同一になる。root、cwd=リポジトリ（.env に LAN_IFACE）。
set -uo pipefail
W=$(mktemp -d)
snap() {
  local d=$W/$1; mkdir -p "$d"
  find /etc /usr/local -xdev \( -type f -o -type l \) -printf '%p %m %U:%G %l\n' 2>/dev/null | sort > "$d/inventory"
  find /etc /usr/local -xdev -type f -print0 2>/dev/null | sort -z | xargs -0 sha256sum 2>/dev/null > "$d/hash"
  sysctl -a 2>/dev/null | grep -E '^net\.' | grep -vE 'nf_conntrack_count|^net\.netfilter\.nf_conntrack_buckets' | sort > "$d/sysctl"
  nft list tables | sort > "$d/tables"
}
report() {
  echo "--- $1 → $2: ファイル（内容）"
  diff "$W/$1/hash" "$W/$2/hash" | grep -E '^[<>]' | awk '{print $3}' | sort -u | sed 's/^/変更・追加・削除: /'
  echo "--- $1 → $2: ファイル（権限・所有者・リンク）"; diff "$W/$1/inventory" "$W/$2/inventory" | grep -E '^[<>]'
  echo "--- $1 → $2: sysctl net.*"; diff "$W/$1/sysctl" "$W/$2/sysctl" | grep -E '^[<>]'
  echo "--- $1 → $2: nft tables"; diff "$W/$1/tables" "$W/$2/tables" | grep -E '^[<>]'
}
date -u +"開始 %FT%T.%3NZ"
snap before
sh compose/host-preparation.sh apply --yes > "$W/apply.log" 2>&1; echo "apply 終了コード=$?"
snap applied
docker compose -p vpngwgui down >/dev/null 2>&1 || true
sh compose/host-preparation.sh remove > "$W/remove.log" 2>&1; echo "remove 終了コード=$?"
snap removed
report before applied
report before removed
date -u +"終了 %FT%T.%3NZ"
rm -rf "$W"
