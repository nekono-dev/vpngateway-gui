#!/bin/sh
# 責務: deploy-verify の static 検査と失敗検出、秘密情報の引数非露出を確認する。
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

if ! (cd "$root" && env -i PATH="$PATH" HOME="${HOME:-/tmp}" sh scripts/deploy-verify.sh static); then
  printf '%s\n' 'deploy-verify static が失敗しました' >&2
  exit 1
fi

if ! grep -Eq 'SSHPASS=.*sshpass -e (ssh|scp)' "$root/scripts/deploy-verify.sh"; then
  printf '%s\n' 'SSH password must be passed through SSHPASS environment only' >&2
  exit 1
fi
if grep -Eq 'sshpass[[:space:]]+(-p|--password)|sshpass[^\n]*[[:space:]]VERIFY_SSH_PASSWORD' "$root/scripts/deploy-verify.sh"; then
  printf '%s\n' 'SSH password may not be passed as a process argument' >&2
  exit 1
fi

sh "$root/scripts/build-compose-bundle.sh" test "$tmp/bundle.tar.gz"
mkdir "$tmp/extracted"
tar -xzf "$tmp/bundle.tar.gz" -C "$tmp/extracted"
bundle=$(find "$tmp/extracted" -mindepth 1 -maxdepth 1 -type d -print -quit)
sed '/^  proxy:/,/^[^ ]/d' "$bundle/docker-compose.yml" > "$tmp/docker-compose.yml"
mv "$tmp/docker-compose.yml" "$bundle/docker-compose.yml"
if DEPLOY_VERIFY_EXTRACTED_DIR="$bundle" sh "$root/scripts/deploy-verify.sh" static >"$tmp/broken.out" 2>&1; then
  printf '%s\n' 'broken Compose bundle unexpectedly passed static verification' >&2
  exit 1
fi
printf '%s\n' 'deploy-verify static success, broken bundle rejection, and password argument checks passed'
