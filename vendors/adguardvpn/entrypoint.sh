#!/bin/sh
# 責務: コンテナ起動時、実VPNベンダーCLI（AdGuard VPN CLI）がログインセッションの妥当性検証に用いる
# /etc/machine-id を、永続化ボリューム上に保存した値から復元してから本体プロセスを起動する。
#
# 背景: /etc/machine-idはDockerコンテナ再作成のたびに（systemd等が存在しないAlpineベースでは
# ファイル自体が存在しないため）失われる。実CLIバイナリの文字列解析で/etc/machine-idおよび
# /var/lib/dbus/machine-idへの参照が見つかっており、これがコンテナ再作成のたびにログイン
# セッションが失効する不具合の原因と判明した。
# ログイン情報自体は${HOME}/.local/share/adguardvpn-cliを永続化ボリュームとしてマウント済みのため、
# 同ディレクトリ配下にmachine-idも保存することで、既存のvolume定義を変更せずに永続化する。

set -eu

MACHINE_ID_STORE="${HOME}/.local/share/adguardvpn-cli/.machine-id"

if [ ! -s "$MACHINE_ID_STORE" ]; then
  mkdir -p "$(dirname "$MACHINE_ID_STORE")"
  # systemdのmachine-id形式（32桁小文字16進数、末尾改行なし）に合わせて生成する。
  od -An -tx1 -N16 /dev/urandom | tr -d ' \n' > "$MACHINE_ID_STORE"
fi

# /etc/machine-id・/var/lib/dbus/machine-idは事前にvpngwgui所有で用意されている前提（Dockerfile参照）。
cat "$MACHINE_ID_STORE" > /etc/machine-id
cat "$MACHINE_ID_STORE" > /var/lib/dbus/machine-id

exec "$@"
