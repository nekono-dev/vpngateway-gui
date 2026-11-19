#!/bin/sh
# 責務: deploy-verify の static 検査と失敗検出、秘密情報の引数非露出を確認する。
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

mkdir "$tmp/bin"
cat > "$tmp/bin/sh" <<'FAKE_SH'
#!/bin/sh
if [ "$1" = compose/host-preparation.sh ] && [ "$2" = check ]; then
  test -f .env || exit 21
  grep -qx 'LAN_IFACE=lo' .env || grep -qx 'LAN_IFACE=existing0' .env || exit 22
  exit "${FAKE_CHECK_STATUS:-0}"
fi
exec /bin/sh "$@"
FAKE_SH
cat > "$tmp/bin/docker" <<'FAKE_DOCKER'
#!/bin/sh
test "$*" = 'compose -p vpngwgui config --quiet' || exit 31
test -f .env || exit 32
FAKE_DOCKER
chmod +x "$tmp/bin/sh" "$tmp/bin/docker"
mkdir "$tmp/no-env"
if PATH="$tmp/bin:$PATH" sh "$root/scripts/deploy-verify-lab-check.sh" "$tmp/no-env"; then :; else
  printf '%s\n' 'lab checker failed without an existing .env' >&2
  exit 1
fi
[ ! -e "$tmp/no-env/.env" ] || { printf '%s\n' 'temporary .env was not removed' >&2; exit 1; }
mkdir "$tmp/with-env"
printf '%s\n' 'LAN_IFACE=existing0' 'CUSTOM=value' > "$tmp/with-env/.env"
cp "$tmp/with-env/.env" "$tmp/original-env"
PATH="$tmp/bin:$PATH" sh "$root/scripts/deploy-verify-lab-check.sh" "$tmp/with-env"
cmp "$tmp/original-env" "$tmp/with-env/.env"
if PATH="$tmp/bin:$PATH" FAKE_CHECK_STATUS=1 sh "$root/scripts/deploy-verify-lab-check.sh" "$tmp/no-env" >/dev/null 2>&1; then
  printf '%s\n' 'lab checker unexpectedly passed failed host-preparation check' >&2
  exit 1
fi
[ ! -e "$tmp/no-env/.env" ] || { printf '%s\n' 'temporary .env remained after failure' >&2; exit 1; }

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
