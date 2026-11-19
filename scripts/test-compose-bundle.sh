#!/bin/sh
# 責務: Compose bundle の内容と展開後の実行可能性をローカルで検証する。
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT HUP INT TERM

ARCHIVE="$TMP_ROOT/vpngwgui-test.tar.gz"
env -i PATH="$PATH" sh "$ROOT/scripts/build-compose-bundle.sh" test "$ARCHIVE"

tar -tzf "$ARCHIVE" > "$TMP_ROOT/contents.txt"
for required in \
  docker-compose.yml .env.example .dockerignore README.md LICENSE package.json package-lock.json \
  tsconfig.base.json compose/web-tls.yml compose/api-tls.yml \
  compose/host-preparation.sh compose/gateway-entrypoint.sh \
  compose/host-preparation/common.sh compose/host-preparation/docker-forward.sh compose/host-preparation/docker-install.sh vendors/adguardvpn/compose.yml \
  vendors/protonvpn/compose.yml api/Dockerfile web/Dockerfile proxy/Dockerfile
do
  if ! grep -F "/$required" "$TMP_ROOT/contents.txt" >/dev/null; then
    printf 'bundle に必須パスがありません: %s\n' "$required" >&2
    exit 1
  fi
done

if [ -x "$ROOT/compose/host-preparation/docker-install.sh" ]; then
  printf 'Docker 導入スクリプトは読み込み専用資材のため実行権限を付けないでください\n' >&2
  exit 1
fi
if grep -E '(^|/)(\.env|.*\.(key|pem|p12|pfx))(/|$)|(^|/)\.git(/|$)' "$TMP_ROOT/contents.txt" >/dev/null; then
  printf 'bundle に禁止パスが含まれています\n' >&2
  exit 1
fi

mkdir "$TMP_ROOT/extracted"
tar -xzf "$ARCHIVE" -C "$TMP_ROOT/extracted"
BUNDLE="$TMP_ROOT/extracted/vpngwgui-test"

# host-preparation が参照する資材を漏れなく含むよう、実ディレクトリを manifest と bundle に照合する。
find "$ROOT/compose/host-preparation" -type f ! -path '*/tests/*' -print | while IFS= read -r source_file; do
  relative_path=${source_file#"$ROOT/"}
  if ! grep -Fqx "$relative_path" "$ROOT/scripts/bundle-manifest.txt"; then
    printf 'host-preparation 資材が manifest にありません: %s\n' "$relative_path" >&2
    exit 1
  fi
  if ! grep -F "/$relative_path" "$TMP_ROOT/contents.txt" >/dev/null; then
    printf 'host-preparation 資材が bundle にありません: %s\n' "$relative_path" >&2
    exit 1
  fi
  if [ ! -f "$BUNDLE/$relative_path" ]; then
    printf '展開後 bundle に host-preparation 資材がありません: %s\n' "$relative_path" >&2
    exit 1
  fi
done

if command -v docker >/dev/null 2>&1; then
  (cd "$BUNDLE" && env -i PATH="$PATH" HOME="$TMP_ROOT" docker compose -p vpngwgui -f docker-compose.yml config --quiet)
else
  printf 'docker がないため Compose config 検査を実行できません\n' >&2
  exit 1
fi

if (cd "$BUNDLE" && env -i PATH="$PATH" sh compose/host-preparation.sh __bundle_smoke_unknown_command); then
  printf 'host-preparation の未知コマンドが成功しました\n' >&2
  exit 1
fi

usage=$(cd "$BUNDLE" && env -i PATH="$PATH" sh compose/host-preparation.sh --help)
printf '%s\n' "$usage" | grep -F '使用方法: host-preparation.sh {check|status|remove|apply [--yes]}' >/dev/null || {
  printf '展開後の host-preparation.sh usage が確認できません\n' >&2
  exit 1
}

printf 'Compose bundle の作成・内容・展開後検査に成功しました\n'
