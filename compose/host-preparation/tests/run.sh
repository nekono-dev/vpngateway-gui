#!/bin/sh
# 責務: host-preparation のシェルテストをまとめて実行する。
set -eu

test_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
for test_file in "$test_dir"/*.test.sh; do
  [ -f "$test_file" ] || continue
  printf 'host-preparation: %s\n' "$(basename -- "$test_file")"
  sh "$test_file"
done
