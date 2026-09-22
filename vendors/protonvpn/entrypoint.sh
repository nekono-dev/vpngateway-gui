#!/bin/bash
# 責務: Proton VPN向けproxyコンテナの起動。Proton VPN公式CLIが依存するシステムD-Bus・NetworkManager・
# セッションD-Bus・Secret Service（gnome-keyring）をコンテナ内で起動してから、proxy本体を非root（vpngwgui）で起動する。
# 起動したバックグラウンドプロセスのいずれかが終了したら、コンテナごと終了する（restart: alwaysで再起動させる。
# 片方だけ死んだ半端な状態で稼働し続けない）。
# 背景・設計: specs/proxyserver/design.md「Proton VPN向けproxyイメージ」、wbs/phase9.md。

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
# みなしログインが失効しうる。別のバンドルのエントリポイントと同じ方針）。
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

# 前回の実行で取り残されたCLI由来のI/F（WireGuardトンネル・Kill Switch用dummy）を消す。コンテナが作り直されると
# CLIの接続状態は失われるのにカーネルのI/Fだけ残り、NMが「外部接続」として抱えてtunnel検出・経路を乱すため。
for ifc in $(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -E '^(proton[0-9]+|pvpnksintrf[0-9]+|ipv6leakintrf[0-9]+)$' || true); do
  ip link del "$ifc" 2>/dev/null && log "取り残されたI/Fを削除: $ifc"
done

# 1) システムD-Bus
mkdir -p /run/dbus
rm -f /run/dbus/pid /run/dbus/system_bus_socket
dbus-daemon --system --fork --nopidfile
log "システムD-Bus起動"

# 2) NetworkManager（設定はテンプレートから生成する。WireGuard・dummy・上り側NIC以外は管理対象外）
# 上り側NIC: LAN_IFACE（未設定ならdefault経路のIF）。CLIのWireGuard接続が、サーバ宛の経路をNMの管理下の物理NICへ足すため必須。
UPLINK_IFACE="${LAN_IFACE:-$(ip -4 route show default 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1); exit}}')}"
case "$UPLINK_IFACE" in
  ""|*[!A-Za-z0-9._-]*) UPLINK_EXCEPT="" ;;
  *) UPLINK_EXCEPT=",except:interface-name:$UPLINK_IFACE" ;;
esac
sed "s|__UPLINK_EXCEPT__|$UPLINK_EXCEPT|" /usr/local/share/networkmanager-vpngwgui.conf.tmpl > /etc/NetworkManager/conf.d/99-vpngwgui.conf
log "NM管理対象の上り側NIC: ${UPLINK_IFACE:-（なし）}"

# NMは「ユーザ限定（permissions=user:vpngwgui）」の接続プロファイルを、そのユーザのログインセッションが
# 無いと有効化しない。CLIのKill Switch・WireGuard接続は全てこの形式で作られるが、コンテナにはlogindが無い。
# NMが参照するlogindのセッション情報（/run/systemd/users・sessions）を、vpngwguiが常時ログイン中である体で置く。
mkdir -p /run/systemd/users /run/systemd/sessions
printf 'NAME=%s\nSTATE=active\nSESSIONS=1\nONLINE_SESSIONS=1\nACTIVE_SESSIONS=1\nDISPLAY=1\n' "$RUN_USER" > "/run/systemd/users/$RUN_UID"
printf 'UID=%s\nUSER=%s\nACTIVE=1\nIS_DISPLAY=1\nSTATE=active\nREMOTE=0\nCLASS=user\nTYPE=tty\n' "$RUN_UID" "$RUN_USER" > /run/systemd/sessions/1

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
# keyringを解錠する。ヘッドレスのため対話入力できない。**空のパスワードでは、初回のログインkeyringの作成が
# GUIのプロンプト（org.gnome.keyring.SystemPrompter）を要求して失敗する**（PoCで確認）ため、ランダムなパスワードを
# 永続化ボリューム（~/.config/Proton）に0600で保存して使う。keyringの実体（~/.local/share/keyrings）と別のボリュームだが、
# 同じコンテナから読めるため暗号化としての強度は無い（CLIのトークンを保管するSecret Serviceを成立させるための措置）。
KEYRING_PASS_FILE="$RUN_HOME/.config/Proton/.keyring-pass"
if [ ! -s "$KEYRING_PASS_FILE" ]; then
  od -An -tx1 -N24 /dev/urandom | tr -d ' \n' > "$KEYRING_PASS_FILE"
  chown "$RUN_UID:$RUN_GID" "$KEYRING_PASS_FILE"
  chmod 0600 "$KEYRING_PASS_FILE"
fi
KEYRING_ENV="HOME=$RUN_HOME XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"
# --login: パスワードを標準入力から読み、ログインkeyringが無ければ作成し、あれば解錠する。続けて--startでSecret Serviceを開始する。
run_as env $KEYRING_ENV gnome-keyring-daemon --daemonize --login < "$KEYRING_PASS_FILE" >/dev/null
run_as env $KEYRING_ENV gnome-keyring-daemon --start --components=secrets >/dev/null
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
