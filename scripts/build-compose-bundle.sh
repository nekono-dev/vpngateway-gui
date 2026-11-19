#!/bin/sh
# 責務: bundle manifest から再現可能な Compose 配布 tarball を作る。
set -eu

usage() {
  printf '%s\n' 'Usage: build-compose-bundle.sh <version> <output-tar.gz>' >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
version=$1
output=$2
case "$version" in
  ''|*[!A-Za-z0-9._+-]*) usage ;;
esac

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
manifest=$root/scripts/bundle-manifest.txt
stage_root=$(mktemp -d)
trap 'rm -rf "$stage_root"' EXIT HUP INT TERM
bundle_name=vpngwgui-$version
bundle=$stage_root/$bundle_name
mkdir -p "$bundle"

check_path() {
  candidate=$1
  case "$candidate" in
    /*|..|../*|*/../*|*/..|.env|.env/*|installer|installer/*|.git|.git/*|.claude|.claude/*)
      printf '禁止された bundle path: %s\n' "$candidate" >&2
      exit 1
      ;;
    *[!A-Za-z0-9._/-]*)
      printf '不正な bundle path: %s\n' "$candidate" >&2
      exit 1
      ;;
  esac
}

while IFS= read -r path || [ -n "$path" ]; do
  case "$path" in ''|\#*) continue ;; esac
  check_path "$path"
  source=$root/$path
  [ -e "$source" ] || {
    printf 'manifest のパスがありません: %s\n' "$path" >&2
    exit 1
  }
  if [ -L "$source" ]; then
    printf 'symlink は bundle に含められません: %s\n' "$path" >&2
    exit 1
  fi
  mkdir -p "$bundle/$(dirname -- "$path")"
  cp -R "$source" "$bundle/$path"
done < "$manifest"

# ビルド対象外の Web テスト証明書・秘密鍵は実行 bundle に含めない。
rm -rf "$bundle/web/server/testdata"
find "$bundle" -type d \( -name node_modules -o -name dist -o -name dist-server -o -name coverage -o -name tests \) -prune -exec rm -rf {} \;
find "$bundle" -type f \( -name '*.test.*' -o -name '*.key' -o -name '*.pem' -o -name '*.p12' -o -name '*.pfx' \) -exec rm -f {} \;
find "$bundle" -type f \( -name .env -o -name '.env.*' \) ! -path "$bundle/.env.example" -exec rm -f {} \;

for required in docker-compose.yml .env.example README.md LICENSE LICENSE-jp package.json package-lock.json tsconfig.base.json \
  compose/web-tls.yml compose/api-tls.yml compose/host-preparation.sh compose/gateway-entrypoint.sh \
  compose/host-preparation/common.sh vendors/adguardvpn/compose.yml vendors/protonvpn/compose.yml \
  api/Dockerfile web/Dockerfile proxy/Dockerfile
do
  [ -e "$bundle/$required" ] || {
    printf '必須資材が manifest にありません: %s\n' "$required" >&2
    exit 1
  }
done

if find "$bundle" \( -name installer -o -name .env -o -name '*.key' -o -name '*.pem' -o -name '*.p12' -o -name '*.pfx' \) -print | grep . >/dev/null; then
  printf '%s\n' 'bundle に禁止された installer・環境・鍵ファイルがあります' >&2
  exit 1
fi
if find "$bundle/compose/host-preparation" -type d -name tests -print | grep . >/dev/null; then
  printf '%s\n' 'host-preparation のテスト資材は bundle に含められません' >&2
  exit 1
fi

output_dir=$(dirname -- "$output")
mkdir -p "$output_dir"
output_abs=$output_dir/$(basename -- "$output")
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -cf - -C "$stage_root" "$bundle_name" | gzip -n > "$output_abs"
