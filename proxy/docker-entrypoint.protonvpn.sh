#!/bin/bash
# 責務: Proton VPN向けproxyコンテナの起動。Proton VPN公式CLIが依存するシステムD-Bus・NetworkManager・
# セッションD-Bus・Secret Service（gnome-keyring）をコンテナ内で起動してから、proxy本体を非root（vpngwgui）で起動する。
# 起動したバックグラウンドプロセスのいずれかが終了したら、コンテナごと終了する（restart: alwaysで再起動させる。
# 片方だけ死んだ半端な状態で稼働し続けない）。
# 背景・設計: specs/proxyserver/design.md「Proton VPN向けproxyイメージ」、wbs/phase10.md。

set -eu

RUN_USER=vpngwgui
RUN_UID=$(id -u "$RUN_USER")
RUN_GID=$(id -g "$RUN_USER")
RUN_HOME=/home/$RUN_USER
export XDG_RUNTIME_DIR=/run/user/$RUN_UID

log() { echo "[entrypoint] $*"; }
run_as() { setpriv --reuid="$RUN_UID" --regid="$RUN_GID" --init-groups "$@"; }

# rootで起動されなかった場合（user指定漏れ）は、D-Bus・NMを起動できないため明示的に失敗させる。
if [ "$(id -u)" != 0 ]; then
  log "root権限で起動してください（docker-compose.protonvpn.ymlのuser: \"0:0\"）"
  exit 1
fi

# /etc/machine-idをボリューム上の値から復元する（コンテナ再作成のたびに変わると、NM・keyringが別の端末と
# みなしログインが失効しうる。AdGuard用のdocker-entrypoint.shと同じ方針）。
MACHINE_ID_STORE="$RUN_HOME/.config/Proton/.machine-id"
if [ ! -s "$MACHINE_ID_STORE" ]; then
  mkdir -p "$(dirname "$MACHINE_ID_STORE")"
  od -An -tx1 -N16 /dev/urandom | tr -d ' \n' > "$MACHINE_ID_STORE"
  chown "$RUN_UID:$RUN_GID" "$MACHINE_ID_STORE"
fi
cat "$MACHINE_ID_STORE" > /etc/machine-id
mkdir -p /var/lib/dbus && cp /etc/machine-id /var/lib/dbus/machine-id

# ボリュームの所有権（新規のnamed volumeはroot所有で作られることがある）。
chown "$RUN_UID:$RUN_GID" "$RUN_HOME" "$RUN_HOME/.config" "$RUN_HOME/.cache" "$RUN_HOME/.local" "$RUN_HOME/.local/share" 2>/dev/null || true
chown -R "$RUN_UID:$RUN_GID" "$RUN_HOME/.config/Proton" "$RUN_HOME/.cache/Proton" "$RUN_HOME/.local/share/keyrings"

# 1) システムD-Bus
mkdir -p /run/dbus
rm -f /run/dbus/pid /run/dbus/system_bus_socket
dbus-daemon --system --fork --nopidfile
log "システムD-Bus起動"

# 2) NetworkManager（設定は/etc/NetworkManager/conf.d/99-vpngwgui.conf。WireGuard以外は管理対象外）
mkdir -p /run/NetworkManager
NetworkManager --no-daemon &
NM_PID=$!
for _ in $(seq 1 30); do
  nmcli -t general status >/dev/null 2>&1 && break
  sleep 1
done
nmcli -t general status >/dev/null 2>&1 || { log "NetworkManagerがD-Bus上で応答しません"; exit 1; }
log "NetworkManager起動 (pid $NM_PID)"

# 3) vpngwguiのセッションD-Bus・Secret Service（gnome-keyring）。CLIのログイン情報（トークン）の保管先。
mkdir -p "$XDG_RUNTIME_DIR"
chown "$RUN_UID:$RUN_GID" "$XDG_RUNTIME_DIR"
chmod 0700 "$XDG_RUNTIME_DIR"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
run_as env DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" dbus-daemon --session --fork --nopidfile --address="$DBUS_SESSION_BUS_ADDRESS"
# 空のパスワードで解錠する（ヘッドレスのため対話入力できない。keyringの実体は永続化ボリューム上）。
printf '' | run_as env HOME="$RUN_HOME" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
  gnome-keyring-daemon --daemonize --unlock --components=secrets >/dev/null
log "セッションD-Bus・keyring起動"

# 4) proxy本体（非root）
run_as env HOME="$RUN_HOME" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" "$@" &
APP_PID=$!
log "proxy本体起動 (pid $APP_PID)"

# 終了シグナルは子へ伝える。どれか1つでも終了したら、コンテナごと終了する。
trap 'kill "$APP_PID" "$NM_PID" 2>/dev/null || true' TERM INT
wait -n "$APP_PID" "$NM_PID" || true
log "プロセスが終了したためコンテナを終了します"
kill "$APP_PID" "$NM_PID" 2>/dev/null || true
exit 1
