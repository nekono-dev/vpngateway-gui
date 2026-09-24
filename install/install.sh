#!/bin/sh
# 責務: クリーンなDebian系ベアメタル（Debian・Raspberry Pi OS・Ubuntu）へ、プラットフォーム（web・api・proxy）と、有効にしたVPNベンダーの
# ランナーを導入・起動する本体インストーラ。1本で完結し、冪等（再実行は更新・ベンダーの変更・修復を兼ねる）。
# 通常は頒布されるブートストラップ（install/bootstrap.sh）が、ソースの取得後にこのスクリプトを呼ぶ。手動でcloneした場合は直接実行してよい。
# 設計: specs/design.md「インストーラと頒布（Phase 13）」「デプロイメント構成の分離とロール別インストール（Phase 25）」、
#       要件: specs/requirements.md「インストール」「デプロイメント構成の分離」「通信路の保護」。
#
# 処理の概要（利用者が実行する1回の呼び出しで完結する。--api・--web・--gatewayでロールを別ホストへ分離できる）:
#   0. トポロジーの決定（--api・--web・--gatewayから、ロール→配置先ホストを決める）・
#      指定したリモートホストすべてへのSSH/SCP到達性の事前検証（いずれかに変更を加える前に検証する）
#   1. 証明書の生成・配布（オーケストレーター＝このコマンドを実行したホストがローカルで生成し、各ロールの配置先へ配置する）
#   2〜9. ロールごとに実行（配置先がローカルなら以下をこのプロセス内で、リモートならソース転送＋sshで同じ処理を実行させる）:
#      事前検査 → 共通の依存パッケージとDocker → ホスト設定（gatewayロールのみ: IPフォワーディング・起動時のKill Switchガード）→
#      .envの作成・更新（配置されたロールのcompose fragment・gatewayロールのみ: 有効なベンダー）→
#      ベンダー固有のホスト側手順（gatewayロールのみ、あるベンダーだけ）→ 起動と待機（webロールが配置されたホストのみ待機）
#   10. 完了の表示
# --uninstall指定時は上記を行わず、代わりにこのインストーラが導入・作成したものを、記録済みのトポロジーに基づいて後始末する
# （下記「--uninstall」参照）。
#
# 使い方（root権限で）:
#   sh install/install.sh --providers <ID>[,<ID>...] [--web-port <番号>] [--lan-iface <名前>] [--redetect-lan-iface]
#                          [--api <ホスト名/IP>] [--web <ホスト名/IP>] [--gateway <ホスト名/IP>] [--rotate-pairing] [--no-start]
#   --providers            有効にするベンダー（vendors/<ID>/ のディレクトリ名）。省略時は、その時点でvendors/にある全ベンダー（all）を有効にする
#                           （新しい版で追加されたベンダーも、再実行のたびに自動的に有効化される）。gatewayロールが配置されたホストでのみ意味を持つ。
#   --web-port             Web UIを配信するホスト側のポート番号（1〜65535）。省略時は、.envの既存値（無ければ80）を使う。webロールが配置された
#                           ホストでのみ意味を持つ。
#   --lan-iface            LAN側インターフェース名を指定する（自動検出できない・複数NICの場合）。gatewayロールが配置されたホストでのみ意味を持つ。
#   --redetect-lan-iface   保存済みのLAN側インターフェース名を捨てて再検出する。
#   --api <ホスト名/IP>    APIサーバの配置先。省略時はこのコマンドを実行したホスト（ローカル）。
#   --web <ホスト名/IP>    Webサーバの配置先。省略時はローカル。
#   --gateway <ホスト名/IP> ゲートウェイ（プロキシサーバ・ランナー）の配置先。省略時はローカル。
#                           --api・--web・--gatewayをいずれも指定しない場合は単一ホスト構成（全ロールをローカルへ配置）となる。
#                           リモートホストへは、このコマンドを実行するユーザーと同じユーザー名でのSSH/SCPアクセス（鍵認証）が
#                           事前に確立済みであること（ユーザー名・秘密鍵・ポートを指定する引数は無い。必要なら~/.ssh/configで吸収する）。
#                           再実行時、記録済みのトポロジーと異なる指定はエラーで停止する（構成変更は--uninstall後の再インストールで行う）。
#   --rotate-pairing        既存の証明書一式を破棄し、再生成・再配布する（相手ホストを作り直した場合等）。
#   --no-start             起動（docker compose up）をしない。
# 例（単一ホスト）:     sudo sh install/install.sh --providers vendora,vendorb
# 例（3ホストへ分離）: sudo sh install/install.sh --web 192.168.1.10 --api 192.168.1.11 --gateway 192.168.1.12 --providers vendora
#
# 使い方（アンインストール、root権限で）: sh install/install.sh --uninstall [--keep-data]
#   --uninstall            記録済みのトポロジーに基づいて後始末する。--api・--web・--gatewayとは併用できない
#                           （分離構成では、このコマンドを実行したホスト＝オーケストレーターで実行すること。記録が無いホストで
#                           実行した場合は警告のうえ、そのホスト自身の後始末のみ行う）。docker composeスタックの停止・削除
#                           （既定でボリューム＝ベンダーのログイン情報も削除）、証明書一式、IPフォワーディング設定、起動時の
#                           Kill Switchガード、有効なベンダーのホスト側の後始末（vendors/<ID>/uninstall-host.sh。あるベンダーだけ）、
#                           ソース一式の取得先ディレクトリ（自分自身）の削除を行う。Docker本体・apt依存パッケージは対象外
#                           （手動で削除すること。README.md参照）。
#   --keep-data             --uninstall と併用。ベンダーのログイン情報（Dockerボリューム）を削除せず残す（再導入時にログイン状態を維持したい場合）。
# 例（頒布されたブートストラップ経由。ソースの取得先が無くても実行できる）: curl -fsSL <頒布URL>/install.sh | sudo sh -s -- --uninstall
# 例（取得済みのソースから直接実行）: sudo sh install/install.sh --uninstall

set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# 通常はこのスクリプトの1つ上（リポジトリのルート）。VPNGW_REPO_ROOT は、検査が関数だけを読み込むときのために、ルートを明示する。
REPO_ROOT=${VPNGW_REPO_ROOT:-$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)}
ENV_FILE="$REPO_ROOT/.env"
VENDORS_DIR="$REPO_ROOT/vendors"
SYSCTL_FILE="/etc/sysctl.d/99-vpngwgui.conf"
GUARD_UNIT="/etc/systemd/system/vpngwgui-boot-guard.service"
WEB_PORT_DEFAULT=80
# 通信路の保護に使う証明書一式の置き場（specs/design.md「証明書の生成・配布」）。
# ゲートウェイ制御チャネル（api⇄gateway、mTLS）・web⇄api（片方向TLS）・ブラウザ⇄web（片方向TLS）のいずれも、
# 同じ置き場へまとめて配置する（各サーバは自分に必要なファイル名だけを読む）。
PKI_DIR="/etc/vpngwgui/pki"
# コンテナ（api・proxyとも user: "10001:10001"）がread-onlyマウント越しに読めるよう所有者を合わせる。
PKI_UID=10001
PKI_GID=10001
# リモートロールを配置する際のソース転送先（specs/design.md「オーケストレーション型インストーラ」）。
REMOTE_INSTALL_DIR=/opt/vpngwgui
# 新規構築インフラで known_hosts が空であることを前提とした割り切り（specs/design.md参照。能動的なMITMへの耐性は持たない）。
SSH_OPTS="-o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10"
# リモートホストへのSSH/SCPは、このコマンドを実行したユーザーと同じユーザー名で行う（specs/design.md
# 「オーケストレーション型インストーラ」）。uninstallやローカルにロールがある場合は`sudo`で再実行されるため、
# その場合は`$SUDO_USER`（sudoを呼び出した元のユーザー）を使う（rootユーザー自身での直接ログインは
# 前提にしない）。
SSH_USER=${SUDO_USER:-$(id -un)}
# sudoで実行中（root）の場合、ssh/scpの鍵はroot自身のもの（/root/.ssh）ではなく、元のユーザー
# （$SUDO_USER）のものを使う必要があるため、`sudo -u $SUDO_USER`でssh/scpプロセス自体もそのユーザーとして
# 実行する（`ssh user@host`は接続先のユーザー名を変えるだけで、鍵の探索元は実行プロセス自身の$HOMEのまま）。
if [ "$(id -un)" = root ] && [ -n "${SUDO_USER:-}" ]; then
  SSH_AS="sudo -u $SUDO_USER"
else
  SSH_AS=""
fi

PROVIDERS_ARG=""
WEB_PORT_ARG=""
LAN_IFACE_ARG=""
REDETECT_LAN=0
NO_START=0
UNINSTALL=0
KEEP_DATA=0
API_HOST_ARG=""
WEB_HOST_ARG=""
GATEWAY_HOST_ARG=""
ROTATE_PAIRING=0
# 内部専用（利用者向けの公開インターフェースではない）。オーケストレーターが、リモートホストへ限定実行を
# 指示するために使う（specs/design.md「オーケストレーション型インストーラ」「ロールごとの実行」）。
ONLY_ROLES_ARG=""
GATEWAY_HOST_OVERRIDE_ARG=""
API_ORIGIN_OVERRIDE_ARG=""

# 目的: 進行状況・エラーを標準出力・標準エラーへ出す。
# 入力: 表示する文字列。
log() { printf '==> %s\n' "$*"; }
die() { printf 'エラー: %s\n' "$*" 1>&2; exit 1; }

# 目的: 使い方を表示する。
usage() {
  sed -n '/^# 使い方/,/^set -eu/p' "$0" | sed '/^set -eu/d;s/^# \{0,1\}//'
}

# 目的: コマンドライン引数を解釈して、上のグローバル変数へ入れる。
# 入力: スクリプトの引数。 失敗時: 不明な引数・値の欠落は終了する。
parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --providers) [ "$#" -ge 2 ] || die "--providers には値が必要です"; PROVIDERS_ARG=$2; shift 2 ;;
      --providers=*) PROVIDERS_ARG=${1#*=}; shift ;;
      --web-port) [ "$#" -ge 2 ] || die "--web-port には値が必要です"; WEB_PORT_ARG=$2; shift 2 ;;
      --web-port=*) WEB_PORT_ARG=${1#*=}; shift ;;
      --lan-iface) [ "$#" -ge 2 ] || die "--lan-iface には値が必要です"; LAN_IFACE_ARG=$2; shift 2 ;;
      --lan-iface=*) LAN_IFACE_ARG=${1#*=}; shift ;;
      --redetect-lan-iface) REDETECT_LAN=1; shift ;;
      --api) [ "$#" -ge 2 ] || die "--api には値が必要です"; API_HOST_ARG=$2; shift 2 ;;
      --api=*) API_HOST_ARG=${1#*=}; shift ;;
      --web) [ "$#" -ge 2 ] || die "--web には値が必要です"; WEB_HOST_ARG=$2; shift 2 ;;
      --web=*) WEB_HOST_ARG=${1#*=}; shift ;;
      --gateway) [ "$#" -ge 2 ] || die "--gateway には値が必要です"; GATEWAY_HOST_ARG=$2; shift 2 ;;
      --gateway=*) GATEWAY_HOST_ARG=${1#*=}; shift ;;
      --rotate-pairing) ROTATE_PAIRING=1; shift ;;
      --no-start) NO_START=1; shift ;;
      --uninstall) UNINSTALL=1; shift ;;
      --keep-data) KEEP_DATA=1; shift ;;
      # 内部専用引数（usageには出さない。オーケストレーターがリモート実行時にのみ渡す）。
      --only-roles) [ "$#" -ge 2 ] || die "--only-roles には値が必要です"; ONLY_ROLES_ARG=$2; shift 2 ;;
      --gateway-host) [ "$#" -ge 2 ] || die "--gateway-host には値が必要です"; GATEWAY_HOST_OVERRIDE_ARG=$2; shift 2 ;;
      --api-origin) [ "$#" -ge 2 ] || die "--api-origin には値が必要です"; API_ORIGIN_OVERRIDE_ARG=$2; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "不明な引数です: $1（--help で使い方を表示）" ;;
    esac
  done
  [ "$KEEP_DATA" -eq 0 ] || [ "$UNINSTALL" -eq 1 ] || die "--keep-data は --uninstall と併用してください"
  if [ "$UNINSTALL" -eq 1 ]; then
    { [ -z "$API_HOST_ARG" ] && [ -z "$WEB_HOST_ARG" ] && [ -z "$GATEWAY_HOST_ARG" ]; } \
      || die "--uninstall は --api・--web・--gateway と併用できません（後始末の範囲は記録済みのトポロジーから自動的に決まります）"
  fi
}

# 目的: .envから1つの値を取り出す。
# 入力: キー名。 出力: 値（最後の定義。無ければ空文字列）。
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
}

# 目的: .envのキーを設定する（他の行は保持する。無ければ追加、あれば置き換え）。
# 入力: キー名, 値。 副作用: .envを書き換える（一時ファイル経由）。
env_set() {
  if [ -f "$ENV_FILE" ]; then
    grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  fi
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
}

# 目的: .envのキーを削除する（無ければ何もしない）。
env_unset() {
  [ -f "$ENV_FILE" ] || return 0
  grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

# 目的: 導入先ホストがこのインストーラの対象か検査する。
# 出力: 検査を通ればグローバル変数 OS_ID・OS_LIKE・OS_CODENAME・ARCH を設定する。
# 失敗時: 理由を示して終了する（root・Debian系・systemd・対応CPU）。
preflight() {
  [ "$(id -u)" -eq 0 ] || die "root権限で実行してください（例: sudo sh $0 --providers <ID>）"
  [ -r /etc/os-release ] || die "/etc/os-release が読めません。Debian系のOSが必要です"
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID=${ID:-}
  OS_LIKE=${ID_LIKE:-}
  OS_CODENAME=${VERSION_CODENAME:-}
  case " $OS_ID $OS_LIKE " in
    *" debian "*|*" ubuntu "*|*" raspbian "*) ;;
    *) die "対応していないOSです（ID=$OS_ID）。Debian・Raspberry Pi OS・Ubuntu が必要です" ;;
  esac
  [ -n "$OS_CODENAME" ] || die "OSのコードネーム（VERSION_CODENAME）を取得できません"
  [ -d /run/systemd/system ] || die "systemd が動いていません（起動時のKill Switchガードにsystemdが必要です）"
  ARCH=$(dpkg --print-architecture)
  case "$ARCH" in
    amd64|arm64|armhf) ;;
    *) die "対応していないCPUです（$ARCH）。amd64・arm64・armhf が必要です" ;;
  esac
  log "対象: $OS_ID $OS_CODENAME ($ARCH)"
}

# 目的: 共通の依存パッケージを導入する（導入済みのものは何もしない）。
# 副作用: aptでパッケージを導入する。
install_packages() {
  missing=""
  for pkg in ca-certificates curl gnupg git iproute2 nftables; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing="$missing $pkg"
  done
  if [ -z "$missing" ]; then
    log "依存パッケージ: 導入済み"
    return 0
  fi
  log "依存パッケージを導入:$missing"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  # shellcheck disable=SC2086
  apt-get install -y -qq $missing >/dev/null
}

# 目的: DockerをDocker公式のaptリポジトリから導入する。docker composeが既に使えるなら何もしない（別の方法で入れた環境を壊さない）。
# 失敗時: dockerはあるがcompose v2が無い場合は、既存の導入を壊さないよう、理由を示して終了する。
# 副作用: /etc/apt/keyrings/docker.asc と /etc/apt/sources.list.d/docker.list を作り、docker-ce等を導入、dockerを有効化・起動する。
install_docker() {
  if docker compose version >/dev/null 2>&1; then
    log "Docker: 導入済み（$(docker --version)）"
    return 0
  fi
  if command -v docker >/dev/null 2>&1; then
    die "docker は入っていますが docker compose（v2）が使えません。compose plugin を導入するか、docker を削除してから再実行してください"
  fi
  case "$OS_ID" in
    ubuntu) docker_repo=ubuntu ;;
    debian|raspbian) docker_repo=debian ;;
    *) case " $OS_LIKE " in *" ubuntu "*) docker_repo=ubuntu ;; *) docker_repo=debian ;; esac ;;
  esac
  log "Dockerを公式リポジトリ（$docker_repo）から導入"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$docker_repo/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$docker_repo $OS_CODENAME stable" > /etc/apt/sources.list.d/docker.list
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  # Docker Engine 28以降は、IPフォワーディングを自ら有効化した際にiptables/nftablesのFORWARDチェーンの
  # 既定ポリシーをDROPへ変更する（ホストをルータ用途で使うと、Docker管理外の転送が遮断される。実機の
  # arm64クリーンホストで発覚。amd64でも同条件で再現しうる）。本製品はnftables専用テーブル(vpngwgui)で
  # LAN機器の転送を自前で制御するため、Dockerにこの変更をさせない（daemon.jsonが無い場合のみ作成し、
  # 既存の設定は上書きしない）。
  if [ ! -e /etc/docker/daemon.json ]; then
    install -m 0755 -d /etc/docker
    printf '{\n  "ip-forward-no-drop": true\n}\n' > /etc/docker/daemon.json
  fi
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  systemctl enable --now docker
  docker compose version >/dev/null 2>&1 || die "Dockerの導入後も docker compose が使えません"
}

# 目的: IPフォワーディングを永続的に有効化する設定ファイルを作り、反映する（LAN機器への透過ゲートウェイに必要）。
#       あわせてICMPリダイレクトの送出を無効にする（単一NICでLAN機器の通信が同一インターフェースへ折り返すとき、
#       ゲートウェイが「ルータへ直接送れ」と指示してしまい、ドメイン迂回・透過ゲートウェイを迂回されるのを防ぐ）。
# 入力: グローバル変数 LAN_IFACE（setup_lan_iface実行後に呼ぶこと）。
# 副作用: /etc/sysctl.d/99-vpngwgui.conf を作成し、その設定だけをsysctlへ反映する。
setup_sysctl() {
  cat > "$SYSCTL_FILE" <<EOSYSCTL
# vpngateway-gui: LAN機器への透過ゲートウェイ提供に必要なIPフォワーディング設定。
# install/install.shにより作成された。手動で削除・変更しないこと。
net.ipv4.ip_forward=1
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.default.send_redirects=0
net.ipv4.conf.${LAN_IFACE}.send_redirects=0
EOSYSCTL
  # `sysctl --system`は無関係な他のファイル（kernel.pid_max等）も適用し、コンテナ等では権限エラーになるため、自分のファイルだけを適用する。
  sysctl -q -p "$SYSCTL_FILE" >/dev/null || die "IPフォワーディングを有効にできません（$SYSCTL_FILE）"
  log "IPフォワーディング: 有効（$SYSCTL_FILE）"
}

# 目的: LAN側インターフェース名を決めて.envへ書く。
# 入力: グローバル変数 LAN_IFACE_ARG・REDETECT_LAN。
# 出力: グローバル変数 LAN_IFACE。
# 挙動: --lan-iface が最優先。次に、.envの既存値（--redetect-lan-iface でなければ維持）。無ければ、デフォルトゲートウェイの逆引きで検出する
#       （VPN未接続のときに実行すること。接続中はトンネルを検出してしまう）。
# 失敗時: 検出できない・不正な名前（ユニットファイルへ埋め込むため、英数字と._-のみ許可）は終了する。
setup_lan_iface() {
  if [ -n "$LAN_IFACE_ARG" ]; then
    LAN_IFACE=$LAN_IFACE_ARG
  else
    LAN_IFACE=$(env_get LAN_IFACE)
    if [ -z "$LAN_IFACE" ] || [ "$REDETECT_LAN" -eq 1 ]; then
      LAN_IFACE=$(ip route show default | awk '{ for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1) }' | head -n 1)
      [ -n "$LAN_IFACE" ] || die "LAN側インターフェースを検出できません（デフォルトルートがありません）。--lan-iface <名前> で指定してください"
    fi
  fi
  case "$LAN_IFACE" in
    ""|*[!A-Za-z0-9._-]*) die "不正なインターフェース名です: $LAN_IFACE" ;;
  esac
  env_set LAN_IFACE "$LAN_IFACE"
  log "LAN側インターフェース: $LAN_IFACE"
}

# 目的: Web UIを配信するホスト側のポート番号を決めて.envへ書く。
# 入力: グローバル変数 WEB_PORT_ARG。
# 出力: グローバル変数 WEB_PORT（docker composeの.envとしても読まれる。ports: "${WEB_PORT:-80}:8080"）。
# 優先順: --web-port ＞ .envの既存値 ＞ 既定（80）。
# 失敗時: 1〜65535の整数でなければ終了する。
setup_web_port() {
  if [ -n "$WEB_PORT_ARG" ]; then
    WEB_PORT=$WEB_PORT_ARG
  else
    WEB_PORT=$(env_get WEB_PORT)
    [ -n "$WEB_PORT" ] || WEB_PORT=$WEB_PORT_DEFAULT
  fi
  case "$WEB_PORT" in
    ''|*[!0-9]*) die "不正なポート番号です: $WEB_PORT" ;;
  esac
  [ "$WEB_PORT" -ge 1 ] && [ "$WEB_PORT" -le 65535 ] || die "不正なポート番号です: $WEB_PORT（1〜65535で指定してください）"
  env_set WEB_PORT "$WEB_PORT"
  log "Web UIのポート: $WEB_PORT"
}

# 目的: 起動時のKill Switchガード（systemd oneshot）を作成・有効化する。
# 背景: `inet vpngwgui`テーブルはDocker→proxy→APIの設定通知を経て初めて作られるため、起動直後の間はLAN機器の通信がVPNを迂回してしまう。
#       ネットワーク起動前に、proxyが適用するものと同名のテーブルへ「LAN側から入る転送はdrop（Docker公開ポート宛のDNATのみ許可）」だけを載せる。
#       proxyは最初の設定通知でこのテーブルを全撤去→再構成（原子的置換）するため、以降は通常のルールに置き換わる。
#       nftables.serviceが有効な環境では、その全消去の後に適用されるよう`After=nftables.service`を付ける。
# 副作用: /etc/systemd/system/vpngwgui-boot-guard.service を作成し、有効化する（今すぐ適用すると稼働中のproxyのルールを上書きするため、起動（start）はしない）。
setup_boot_guard() {
  nft_bin=$(command -v nft) || die "nft コマンドが見つかりません"
  cat > "$GUARD_UNIT" <<EOGUARD
# vpngateway-gui: 起動直後のKill Switch用フェイルクローズガード。install/install.shにより作成された。
[Unit]
Description=vpngateway-gui boot-time fail-closed guard
DefaultDependencies=no
Before=network-pre.target docker.service
# nftables.service（有効な環境。Raspberry Pi OS等）は起動時に/etc/nftables.confで既存のルールを全消去するため、その後に適用する（順序だけ。無くても害はない）。
After=nftables.service
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$nft_bin 'add table inet vpngwgui ; delete table inet vpngwgui ; add table inet vpngwgui ; add chain inet vpngwgui forward { type filter hook forward priority 0 ; policy accept ; } ; add rule inet vpngwgui forward ct status dnat accept ; add rule inet vpngwgui forward iifname "$LAN_IFACE" drop'

[Install]
WantedBy=sysinit.target
EOGUARD
  systemctl daemon-reload
  systemctl enable vpngwgui-boot-guard.service >/dev/null 2>&1
  log "起動時のKill Switchガード: 有効（次回起動から）"
  # nftables.service（/etc/nftables.confを読み込み、既存のルールを全消去する）が有効な環境（Raspberry Pi OS等）では、上のユニットをその後に
  # 順序付けている。利用者の設定は書き換えない。
  if systemctl is-enabled nftables.service >/dev/null 2>&1; then
    log "nftables.service が有効です。起動時のKill Switchガードは、その後に適用されるよう順序付けました"
  fi
}

# 目的: vendors/ 配下の有効なバンドルのID（ディレクトリ名）を一覧する。
# 出力: 1行1ID（profile.jsonとcompose.ymlを持つもの）。
list_bundles() {
  for dir in "$VENDORS_DIR"/*/; do
    # set -e の下で、条件に合わない最後のディレクトリが関数全体の失敗にならないよう、ifで書く。
    if [ -f "${dir}profile.json" ] && [ -f "${dir}compose.yml" ]; then
      basename "$dir"
    fi
  done
}

# 目的: 証明書のSAN（subjectAltName）拡張の値を組み立てる。ロールの配置先ホストが指定されていれば
#      その値を（IPv4表記ならIP:、それ以外はDNS:として）含め、ローカル配置ならこのホストのLAN側アドレスを含める。
# 入力: target(そのロールの--api/--web/--gatewayの値。ローカルなら空文字列), extra(追加で含めるDNS等のSAN項目。無ければ空文字列)。
# 出力: `openssl req`の`-addext`・`-extfile`にそのまま渡せる`subjectAltName=...`の1行（末尾改行なし）。
build_san() {
  target=$1
  extra=${2:-}
  san="DNS:localhost,IP:127.0.0.1"
  [ -z "$extra" ] || san="$san,$extra"
  if [ -n "$target" ]; then
    case "$target" in
      *[!0-9.]*) san="$san,DNS:$target" ;;
      *) san="$san,IP:$target" ;;
    esac
  else
    lan_iface_guess=$(ip route show default | awk '{ for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1) }' | head -n 1)
    if [ -n "$lan_iface_guess" ]; then
      lan_ip=$(ip -4 -o addr show dev "$lan_iface_guess" 2>/dev/null | awk '{ sub("/.*", "", $4); print $4 }' | head -n 1)
      [ -z "$lan_ip" ] || san="$san,IP:$lan_ip"
    fi
  fi
  printf 'subjectAltName=%s' "$san"
}

# 目的: 通信路の保護に使う証明書一式（specs/design.md「証明書の生成・配布」の表）を、オーケストレーター
#      （このコマンドを実行したホスト）のローカルで、作業用ディレクトリへ生成する。
# 入力: グローバル変数 ROLE_HOST_web・ROLE_HOST_api・ROLE_HOST_gateway（各ロールの配置先。ローカルなら空）。
# 出力: グローバル変数 PKI_STAGING（生成した*.crt・*.key一式のディレクトリ。CA秘密鍵は含まない＝配布しない）。
# 失敗時: opensslが無ければ終了する。
generate_role_pki() {
  command -v openssl >/dev/null 2>&1 || die "openssl コマンドが見つかりません"
  PKI_STAGING=$(mktemp -d)

  # gateway-ca・proxyのサーバ証明書・apiのクライアント証明書（api⇄gateway間の相互TLS）。
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$PKI_STAGING/gateway-ca.key" -out "$PKI_STAGING/gateway-ca.crt" \
    -subj "/CN=vpngwgui-gateway-ca" >/dev/null 2>&1

  build_san "$ROLE_HOST_gateway" "DNS:host.docker.internal" > "$PKI_STAGING/proxy-server.ext"
  openssl req -newkey rsa:2048 -nodes \
    -keyout "$PKI_STAGING/proxy-server.key" -out "$PKI_STAGING/proxy-server.csr" \
    -subj "/CN=vpngwgui-proxy" >/dev/null 2>&1
  openssl x509 -req -in "$PKI_STAGING/proxy-server.csr" -CA "$PKI_STAGING/gateway-ca.crt" -CAkey "$PKI_STAGING/gateway-ca.key" \
    -CAcreateserial -days 3650 -out "$PKI_STAGING/proxy-server.crt" \
    -extfile "$PKI_STAGING/proxy-server.ext" >/dev/null 2>&1

  openssl req -newkey rsa:2048 -nodes \
    -keyout "$PKI_STAGING/api-client.key" -out "$PKI_STAGING/api-client.csr" \
    -subj "/CN=vpngwgui-api" >/dev/null 2>&1
  openssl x509 -req -in "$PKI_STAGING/api-client.csr" -CA "$PKI_STAGING/gateway-ca.crt" -CAkey "$PKI_STAGING/gateway-ca.key" \
    -CAcreateserial -days 3650 -out "$PKI_STAGING/api-client.crt" >/dev/null 2>&1

  # api-ca・apiのサーバ証明書（web⇄api間の片方向TLS）。
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$PKI_STAGING/api-ca.key" -out "$PKI_STAGING/api-ca.crt" \
    -subj "/CN=vpngwgui-api-ca" >/dev/null 2>&1
  build_san "$ROLE_HOST_api" "DNS:api" > "$PKI_STAGING/api-server.ext"
  openssl req -newkey rsa:2048 -nodes \
    -keyout "$PKI_STAGING/api-server.key" -out "$PKI_STAGING/api-server.csr" \
    -subj "/CN=vpngwgui-api" >/dev/null 2>&1
  openssl x509 -req -in "$PKI_STAGING/api-server.csr" -CA "$PKI_STAGING/api-ca.crt" -CAkey "$PKI_STAGING/api-ca.key" \
    -CAcreateserial -days 3650 -out "$PKI_STAGING/api-server.crt" \
    -extfile "$PKI_STAGING/api-server.ext" >/dev/null 2>&1

  # webの自己署名サーバ証明書（ブラウザ⇄web間の片方向TLS）。
  web_san=$(build_san "$ROLE_HOST_web" "")
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$PKI_STAGING/web-server.key" -out "$PKI_STAGING/web-server.crt" \
    -subj "/CN=vpngwgui-web" -addext "$web_san" >/dev/null 2>&1

  # CA秘密鍵・署名要求・拡張ファイル・シリアル番号ファイルはこの関数の中だけで使い、配布物には含めない。
  rm -f "$PKI_STAGING/gateway-ca.key" "$PKI_STAGING/api-ca.key" "$PKI_STAGING"/*.csr "$PKI_STAGING"/*.ext "$PKI_STAGING"/*.srl
  log "証明書一式を生成しました（作業用ディレクトリ: $PKI_STAGING）"
}

# 目的: 生成済みの証明書一式（PKI_STAGING）を、このホスト自身のPKI_DIRへ配置する（ローカルにロールが1つ以上ある場合）。
distribute_pki_local() {
  install -m 0755 -d "$PKI_DIR"
  cp "$PKI_STAGING"/*.crt "$PKI_STAGING"/*.key "$PKI_DIR/"
  chown -R "$PKI_UID:$PKI_GID" "$PKI_DIR"
  chmod 700 "$PKI_DIR"
  chmod 600 "$PKI_DIR"/*.key
  chmod 644 "$PKI_DIR"/*.crt
  log "証明書一式を配置しました（$PKI_DIR）"
}

# 目的: 生成済みの証明書一式（PKI_STAGING）を、リモートホストのPKI_DIRへscpで配置する。
# 入力: host(配置先ホスト名/IP)。
# 失敗時: 到達性は事前検証済みだが、配置に失敗した場合は終了する（オーケストレーターの変更を止める）。
distribute_pki_remote() {
  host=$1
  # $PKI_DIRはroot所有で作るため、scp（sudoを使わない）はいったんリモートの一時ディレクトリへ置き、
  # sudo mvで配置先へ移す（e2e/lib/gw.shのgw_pushと同じ手順）。
  # shellcheck disable=SC2086
  remote_tmp=$($SSH_AS ssh $SSH_OPTS "$SSH_USER@$host" 'mktemp -d') || die "リモートホスト $host での作業用ディレクトリの作成に失敗しました"
  # shellcheck disable=SC2086
  $SSH_AS scp $SSH_OPTS -q "$PKI_STAGING"/*.crt "$PKI_STAGING"/*.key "$SSH_USER@$host:$remote_tmp/" \
    || die "リモートホスト $host への証明書配布に失敗しました"
  # $PKI_DIRはroot所有（かつ最終的に700）にするため、*.key・*.crtのグロブ展開を、呼び出し元の
  # 非特権ユーザー（sshログイン先のシェル）ではなく、sudo sh -cの中（root）で行わせる
  # （そうしないと、$PKI_DIRが（再実行等で）既に700の場合、非特権ユーザーがディレクトリを一覧できず
  # グロブが展開されない）。
  # shellcheck disable=SC2086
  $SSH_AS ssh $SSH_OPTS "$SSH_USER@$host" "sudo sh -c 'mkdir -p $PKI_DIR && mv $remote_tmp/*.crt $remote_tmp/*.key $PKI_DIR/ && rmdir $remote_tmp && chown -R $PKI_UID:$PKI_GID $PKI_DIR && chmod 600 $PKI_DIR/*.key && chmod 644 $PKI_DIR/*.crt && chmod 700 $PKI_DIR'" \
    || die "リモートホスト $host での証明書の配置・権限設定に失敗しました"
  log "証明書一式を配布しました（$host:$PKI_DIR）"
}

# 目的: --api・--web・--gatewayの指定から、ロール→配置先ホストの対応（トポロジー）を決める。再実行時は、
#      記録済みのトポロジー（.envのTOPOLOGY_*_HOST）と一致することを検証する（specs/design.md「トポロジーの固定」）。
# 出力: グローバル変数 ROLE_HOST_web・ROLE_HOST_api・ROLE_HOST_gateway（値は指定ホスト名。ローカルなら空文字列）。
# 失敗時: 記録済みのトポロジーと異なる場合は、変更前に終了する（構成変更は--uninstall後の再インストールを要求する）。
determine_topology() {
  ROLE_HOST_web=$WEB_HOST_ARG
  ROLE_HOST_api=$API_HOST_ARG
  ROLE_HOST_gateway=$GATEWAY_HOST_ARG
  if [ "$(env_get TOPOLOGY_RECORDED)" = "1" ]; then
    prev_web=$(env_get TOPOLOGY_WEB_HOST)
    prev_api=$(env_get TOPOLOGY_API_HOST)
    prev_gateway=$(env_get TOPOLOGY_GATEWAY_HOST)
    if [ "$prev_web" != "$ROLE_HOST_web" ] || [ "$prev_api" != "$ROLE_HOST_api" ] || [ "$prev_gateway" != "$ROLE_HOST_gateway" ]; then
      die "配置トポロジーが記録済みの構成と異なります（記録済み: web=${prev_web:-ローカル} api=${prev_api:-ローカル} gateway=${prev_gateway:-ローカル}）。構成を変更する場合は --uninstall で後始末してから、新しいトポロジーで再インストールしてください"
    fi
  fi
  log "トポロジー: web=${ROLE_HOST_web:-ローカル} api=${ROLE_HOST_api:-ローカル} gateway=${ROLE_HOST_gateway:-ローカル}"
}

# 目的: ロール名（web/api/gateway）から、そのロールの配置先ホストを返す。
# 入力: role。 出力: ホスト名/IP（ローカルなら空文字列）。
# 前提: determine_topology（または--uninstallの後始末側での同等の読み込み）が先に実行済みであること。
get_role_host() {
  case "$1" in
    web) printf '%s' "$ROLE_HOST_web" ;;
    api) printf '%s' "$ROLE_HOST_api" ;;
    gateway) printf '%s' "$ROLE_HOST_gateway" ;;
  esac
}

# 目的: 現在のトポロジーで指定されているリモートホスト（ローカルを除く）を、重複を除いて一覧する。
distinct_remote_hosts() {
  { [ -z "$ROLE_HOST_web" ] || printf '%s\n' "$ROLE_HOST_web"
    [ -z "$ROLE_HOST_api" ] || printf '%s\n' "$ROLE_HOST_api"
    [ -z "$ROLE_HOST_gateway" ] || printf '%s\n' "$ROLE_HOST_gateway"
  } | sort -u
}

# 目的: 指定したホストへ配置されているロールを、カンマ区切りで返す（1ホストへ複数ロールを指定した場合に対応）。
# 入力: host。 出力: 例"web,api"（該当ロールが無ければ空文字列）。
roles_assigned_to_host() {
  host=$1
  roles=""
  [ "$ROLE_HOST_web" != "$host" ] || roles="$roles,web"
  [ "$ROLE_HOST_api" != "$host" ] || roles="$roles,api"
  [ "$ROLE_HOST_gateway" != "$host" ] || roles="$roles,gateway"
  printf '%s' "${roles#,}"
}

# 目的: トポロジーで指定されたすべてのリモートホストへのSSH/SCP到達性を、変更を加える前にまとめて検証する
#      （specs/design.md「事前検証（接続性チェック）」。分離構成の一部だけが適用された中途半端な状態を作らない）。
# 失敗時: 1つでも到達できなければ、どのホストにも変更を加える前に終了する。
preflight_remote_hosts() {
  for host in $(distinct_remote_hosts); do
    # shellcheck disable=SC2086
    $SSH_AS ssh $SSH_OPTS "$SSH_USER@$host" true >/dev/null 2>&1 \
      || die "リモートホストへのSSH到達性を確認できません: $host（このコマンドを実行したユーザーと同じユーザー名での鍵認証によるSSHアクセスを、事前に確立してください）"
    log "リモートホストへの到達性を確認しました: $host"
  done
}

# 目的: 有効にするベンダーを決め、グローバル変数へ入れる（.envのVPN_PROVIDERSへも書く）。gatewayロールが
#      配置されたホストでのみ呼ばれる。compose fragmentの合成はinstall_rolesが行う。
# 入力: グローバル変数 PROVIDERS_ARG。
# 出力: グローバル変数 PROVIDERS（カンマ区切り）・PROVIDER_IDS（空白区切り）。
# 優先順: --providers ＞ その時点でvendors/にある全ベンダー（all）。.envの既存のVPN_PROVIDERSは参照しない
#         （初回導入・アップデートのどちらでも同じ規則にし、新しく追加されたベンダーが再実行のたびに自動的に有効化されるようにする）。
# 失敗時: 形式不正・バンドルが無い・重複の場合、または有効にできるベンダーが1つも無い場合は終了する。
determine_providers() {
  if [ -n "$PROVIDERS_ARG" ]; then
    PROVIDERS=$PROVIDERS_ARG
  else
    PROVIDERS=$(list_bundles | tr '\n' ',')
    PROVIDERS=${PROVIDERS%,}
    [ -n "$PROVIDERS" ] || die "有効にできるベンダーがありません（vendors/ 配下にバンドルがありません）"
  fi
  PROVIDER_IDS=$(printf '%s' "$PROVIDERS" | tr ',' ' ')
  seen=" "
  for id in $PROVIDER_IDS; do
    case "$id" in
      [a-z]*) ;;
      *) die "不正なベンダーID: $id" ;;
    esac
    case "$id" in
      *[!a-z0-9]*) die "不正なベンダーID: $id" ;;
    esac
    [ "${#id}" -le 32 ] || die "ベンダーIDが長すぎます: $id"
    case "$seen" in *" $id "*) die "ベンダーIDが重複しています: $id" ;; esac
    seen="$seen$id "
    if [ ! -f "$VENDORS_DIR/$id/profile.json" ] || [ ! -f "$VENDORS_DIR/$id/compose.yml" ]; then
      die "ベンダーバンドルがありません（profile.json・compose.yml が必要）: vendors/$id/。選べるもの: $(list_bundles | tr '\n' ' ')"
    fi
  done
  PROVIDERS=$(printf '%s' "$PROVIDER_IDS" | tr ' ' ',')
  env_set VPN_PROVIDERS "$PROVIDERS"
  log "有効なベンダー: $PROVIDERS"
}

# 目的: 有効なベンダーのホスト側の追加手順（vendors/<ID>/install-host.sh。あるベンダーだけ）を実行する。
# 契約: rootで`sh`により実行。冪等・非対話。環境変数 VPNGW_ROOT（リポジトリのルート）・VPNGW_VENDOR_ID が与えられ、カレントディレクトリはバンドル。
# 失敗時: 非ゼロ終了はインストールの中止（起動の前に終了する）。
run_host_hooks() {
  for id in $PROVIDER_IDS; do
    hook="$VENDORS_DIR/$id/install-host.sh"
    [ -f "$hook" ] || continue
    log "ベンダー $id のホスト側の手順を実行"
    ( cd "$VENDORS_DIR/$id" && VPNGW_ROOT="$REPO_ROOT" VPNGW_VENDOR_ID="$id" sh ./install-host.sh ) || die "ベンダー $id のホスト側の手順（install-host.sh）が失敗しました"
  done
}

# 目的: docker compose でスタックを（再）ビルド・起動し、webロールが含まれる場合はWeb UIが応答するまで待つ。
# 入力: roles(このホストへ配置されたロールのカンマ区切り)。
# 副作用: イメージのビルド・コンテナの作成。無効にしたベンダーのランナーは--remove-orphansで停止・削除される（ログイン情報のボリュームは残る）。
# 失敗時: webロールが含まれ、Web UIが約3分待っても応答しなければ終了する。
start_stack() {
  roles=$1
  cd "$REPO_ROOT"
  log "起動（docker compose up -d --build --remove-orphans。初回はビルドに時間がかかります）"
  docker compose up -d --build --remove-orphans
  case ",$roles," in
    *,web,*)
      log "Web UIの応答を待機"
      waited=0
      # webは自己署名証明書のHTTPSで待ち受ける（specs/webserver/design.md「Webサーバ自身のTLS」）。
      # このヘルスチェックは同一ホスト内の疎通確認に限るため、証明書検証は行わない（-k）。
      # /v1/operatorは未認証でも応答するルート（api/src/auth/require-operator-session.ts）のため、
      # 利用者アカウントの有無に関わらずweb→apiの疎通確認に使える。
      until curl -fsSk -m 3 "https://127.0.0.1:$WEB_PORT/api/v1/operator" >/dev/null 2>&1; do
        waited=$((waited + 3))
        [ "$waited" -lt 180 ] || die "Web UIが応答しません。docker compose logs で確認してください（$REPO_ROOT）"
        sleep 3
      done
      ;;
  esac
}

# 目的: このホストへ配置された1つ以上のロールを導入する。ローカル配置ならオーケストレーター（orchestrate_main）から
#      直接呼ばれ、リモート配置ならssh経由で「sh install/install.sh --only-roles <roles> ...」として呼ばれる
#      （どちらも同じこの関数を実行する。specs/design.md「ロールごとの実行」）。
# 入力: roles(このホストへ配置するロールのカンマ区切り。例"web,api"・"gateway")。
#      グローバル変数 GATEWAY_HOST_OVERRIDE_ARG（apiロールを含む場合、gatewayの接続先を上書き。空ならcomposeの既定）、
#      API_ORIGIN_OVERRIDE_ARG（webロールを含む場合、apiの接続先を上書き。空ならcomposeの既定）。
# 副作用: パッケージ・Dockerの導入、（gatewayロールのみ）ホスト設定、.env（COMPOSE_FILE等）の作成・更新、
#         （gatewayロールのみ）ベンダーのホスト側手順、docker composeの起動。証明書の生成・配布は行わない
#         （呼び出し側が事前に配置済みであること。単一ホスト構成ではorchestrate_mainがローカルへ直接配置する）。
install_roles() {
  roles=$1
  preflight
  install_packages
  install_docker
  case ",$roles," in *,gateway,*) setup_lan_iface; setup_sysctl; setup_boot_guard ;; esac
  case ",$roles," in *,web,*) setup_web_port ;; esac

  # apiは自身がロードするベンダープロファイル（ENABLED_PROVIDERS）を知る必要があるため、gatewayが
  # このホストに無くても（分離構成でapiだけの場合も）VPN_PROVIDERSを決める。
  case ",$roles," in *,api,*|*,gateway,*) determine_providers ;; esac

  files="docker-compose.yml"
  case ",$roles," in *,web,*) files="$files:compose/web.yml" ;; esac
  case ",$roles," in *,api,*) files="$files:compose/api.yml" ;; esac
  case ",$roles," in
    *,gateway,*)
      files="$files:compose/gateway.yml"
      for id in $PROVIDER_IDS; do files="$files:vendors/$id/compose.yml"; done
      ;;
  esac
  env_set COMPOSE_FILE "$files"
  env_unset COMPOSE_PROFILES

  case ",$roles," in
    *,api,*) [ -z "$GATEWAY_HOST_OVERRIDE_ARG" ] || env_set GATEWAY_HOST "$GATEWAY_HOST_OVERRIDE_ARG" ;;
  esac
  case ",$roles," in
    *,web,*) [ -z "$API_ORIGIN_OVERRIDE_ARG" ] || env_set API_ORIGIN "$API_ORIGIN_OVERRIDE_ARG" ;;
  esac

  case ",$roles," in *,gateway,*) run_host_hooks ;; esac

  if [ "$NO_START" -eq 1 ]; then
    log "--no-start のため起動しません（起動: cd $REPO_ROOT && docker compose up -d --build --remove-orphans）"
  else
    start_stack "$roles"
  fi
}

# 目的: リモートホストへ、ソース一式の転送とロールの導入を行う（specs/design.md「ロールごとの実行」）。
# 入力: host(配置先)、roles(そのホストへ配置するロールのカンマ区切り)。
# 副作用: `git archive`によるソース転送（リモートにDocker・Node.js等の事前導入は要求しない）、
#         リモートでの「sh install/install.sh --only-roles ...」実行。
# 失敗時: 転送・リモート実行のいずれかが失敗すれば終了する。
remote_install_role() {
  host=$1
  roles=$2
  log "リモートホスト $host へロール（$roles）を配置します"
  # shellcheck disable=SC2086
  git -C "$REPO_ROOT" archive HEAD | $SSH_AS ssh $SSH_OPTS "$SSH_USER@$host" "sudo mkdir -p $REMOTE_INSTALL_DIR && sudo tar -x -C $REMOTE_INSTALL_DIR" \
    || die "リモートホスト $host へのソース転送に失敗しました"

  extra=""
  case ",$roles," in
    *,api,*)
      gw=$(get_role_host gateway)
      [ -z "$gw" ] || extra="$extra --gateway-host $gw"
      ;;
  esac
  case ",$roles," in
    *,web,*)
      api=$(get_role_host api)
      [ -z "$api" ] || extra="$extra --api-origin https://$api:3000"
      ;;
  esac
  provider_arg=""
  case ",$roles," in *,api,*|*,gateway,*) [ -z "$PROVIDERS_ARG" ] || provider_arg="--providers $PROVIDERS_ARG" ;; esac

  # shellcheck disable=SC2086
  $SSH_AS ssh $SSH_OPTS "$SSH_USER@$host" "cd $REMOTE_INSTALL_DIR && sudo sh install/install.sh --only-roles $roles $provider_arg $extra" \
    || die "リモートホスト $host でのロール導入に失敗しました"
}

# 目的: 完了を表示し、次の操作を案内する（トポロジー全体のサマリ。ロールがリモートに配置されていても表示する）。
finish_summary() {
  summary_port=${WEB_PORT_ARG:-$WEB_PORT_DEFAULT}
  if [ -n "$ROLE_HOST_web" ]; then
    web_addr=$ROLE_HOST_web
  else
    lan_iface_guess=$(ip route show default | awk '{ for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1) }' | head -n 1)
    web_addr=$(ip -4 -o addr show dev "${lan_iface_guess:-lo}" 2>/dev/null | awk '{ sub("/.*", "", $4); print $4 }' | head -n 1)
    web_addr=${web_addr:-<このホストのアドレス>}
  fi
  echo
  log "完了"
  echo "  Web UI:        https://$web_addr:$summary_port（自己署名証明書のため、初回アクセス時にブラウザの警告を許可する）"
  echo "  配置:          web=${ROLE_HOST_web:-ローカル} api=${ROLE_HOST_api:-ローカル} gateway=${ROLE_HOST_gateway:-ローカル}"
  echo "  次の操作:      Web UIを開き、初回はアカウントを作成してログインする。ベンダーごとにログインし、LAN機器のデフォルトゲートウェイをゲートウェイ役のホストへ向ける。"
  echo "  設定の変更:    sudo sh $REPO_ROOT/install/install.sh --providers <ID>,...（同じトポロジーでの再実行で、有効なベンダーを変更できる。トポロジー自体の変更は--uninstall後に行う）"
}

# 目的: インストールの全体（オーケストレーター側）。トポロジーの決定・証明書の生成配布・ロールごとの実行をまとめる
#      （specs/design.md「オーケストレーション型インストーラ」）。
orchestrate_main() {
  determine_topology
  preflight_remote_hosts

  if [ "$(env_get TOPOLOGY_RECORDED)" != "1" ] || [ "$ROTATE_PAIRING" -eq 1 ]; then
    generate_role_pki
    any_local=0
    for role in web api gateway; do
      [ -n "$(get_role_host "$role")" ] || any_local=1
    done
    [ "$any_local" -eq 0 ] || distribute_pki_local
    for host in $(distinct_remote_hosts); do
      distribute_pki_remote "$host"
    done
    rm -rf "$PKI_STAGING"
  else
    log "証明書: 記録済みのトポロジーのため再生成しません（相手ホストを作り直した場合は --rotate-pairing で再生成できます）"
  fi

  env_set TOPOLOGY_WEB_HOST "$ROLE_HOST_web"
  env_set TOPOLOGY_API_HOST "$ROLE_HOST_api"
  env_set TOPOLOGY_GATEWAY_HOST "$ROLE_HOST_gateway"
  env_set TOPOLOGY_RECORDED 1

  local_roles=""
  for role in web api gateway; do
    [ -n "$(get_role_host "$role")" ] || local_roles="$local_roles,$role"
  done
  local_roles=${local_roles#,}
  if [ -n "$local_roles" ]; then
    gw=$(get_role_host gateway)
    api=$(get_role_host api)
    GATEWAY_HOST_OVERRIDE_ARG=""
    API_ORIGIN_OVERRIDE_ARG=""
    case ",$local_roles," in *,api,*) [ -z "$gw" ] || GATEWAY_HOST_OVERRIDE_ARG=$gw ;; esac
    case ",$local_roles," in *,web,*) [ -z "$api" ] || API_ORIGIN_OVERRIDE_ARG="https://$api:3000" ;; esac
    install_roles "$local_roles"
  fi
  for host in $(distinct_remote_hosts); do
    remote_install_role "$host" "$(roles_assigned_to_host "$host")"
  done

  finish_summary
}

# 目的: docker composeスタック（コンテナ・ネットワーク、既定ではボリュームも）を停止・削除する。
# 挙動: .envまたはdocker-compose.ymlが無ければ、導入されていないとみなして何もしない（アンインストールの再実行・未導入ホストでも安全）。
uninstall_stack() {
  if [ ! -f "$REPO_ROOT/docker-compose.yml" ] || ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    log "docker composeスタック: 対象なし（未導入、またはDockerが使えません）"
    return 0
  fi
  cd "$REPO_ROOT"
  if [ "$KEEP_DATA" -eq 1 ]; then
    log "docker composeスタックを削除（ボリューム＝ベンダーのログイン情報は保持）"
    docker compose down --remove-orphans || log "docker compose down に失敗しました（続行します）"
  else
    log "docker composeスタックを削除（ボリューム＝ベンダーのログイン情報も含む）"
    docker compose down --volumes --remove-orphans || log "docker compose down に失敗しました（続行します）"
  fi
}

# 目的: 起動時のKill Switchガード（setup_boot_guardが作成したもの）を無効化・削除する。
uninstall_boot_guard() {
  if [ -f "$GUARD_UNIT" ]; then
    systemctl disable --now vpngwgui-boot-guard.service >/dev/null 2>&1 || true
    rm -f "$GUARD_UNIT"
    systemctl daemon-reload
    log "起動時のKill Switchガード: 削除しました（$GUARD_UNIT）"
  else
    log "起動時のKill Switchガード: 対象なし"
  fi
}

# 目的: IPフォワーディングの永続設定（setup_sysctlが作成したもの）を削除し、稼働中の値も戻す。
uninstall_sysctl() {
  if [ -f "$SYSCTL_FILE" ]; then
    # ICMPリダイレクトの送出設定も、削除前に稼働中の値を既定（有効）へ戻す。
    for key in $(sed -n 's/^\(net\.ipv4\.conf\.[A-Za-z0-9._-]*\.send_redirects\)=.*/\1/p' "$SYSCTL_FILE"); do
      sysctl -w "$key=1" >/dev/null 2>&1 || true
    done
    rm -f "$SYSCTL_FILE"
    sysctl -w net.ipv4.ip_forward=0 >/dev/null 2>&1 || true
    log "IPフォワーディングの設定: 削除しました（$SYSCTL_FILE）"
  else
    log "IPフォワーディングの設定: 対象なし"
  fi
}

# 目的: 証明書一式（generate_role_pki・setup_gateway_pki（Phase25以前）が生成したもの）を削除する。
uninstall_gateway_pki() {
  if [ -d "$PKI_DIR" ]; then
    rm -rf "$PKI_DIR"
    log "証明書一式: 削除しました（$PKI_DIR）"
  else
    log "証明書一式: 対象なし"
  fi
}

# 目的: vendors/ 配下の全バンドル（有効・無効を問わない。アンインストール時点で.envが無い・古い場合があるため）の
#       ホスト側の後始末（vendors/<ID>/uninstall-host.sh。あるベンダーだけ）を実行する。
# 契約: run_host_hooksのuninstall版。同じ環境変数（VPNGW_ROOT・VPNGW_VENDOR_ID）を渡す。
# 失敗時: install時と異なり、1つの失敗で後始末全体を止めない（可能な範囲で後始末を続ける）。
uninstall_host_hooks() {
  [ -d "$VENDORS_DIR" ] || return 0
  for dir in "$VENDORS_DIR"/*/; do
    id=$(basename "$dir")
    hook="${dir}uninstall-host.sh"
    [ -f "$hook" ] || continue
    log "ベンダー $id のホスト側の後始末を実行"
    ( cd "$dir" && VPNGW_ROOT="$REPO_ROOT" VPNGW_VENDOR_ID="$id" sh ./uninstall-host.sh ) || log "ベンダー $id のホスト側の後始末（uninstall-host.sh）が失敗しました（続行します）"
  done
}

# 目的: ソース一式の取得先（REPO_ROOT）を削除する。アンインストールの最後に呼ばれる。
# 安全対策: REPO_ROOTが空・ルート（/）・install/install.sh自身を含まない場合は、取得先ではない別のディレクトリを誤って
#           削除しないよう中止する。削除前にカレントディレクトリをREPO_ROOTの外（/tmp）へ移す（削除後もシェルが継続できるように。
#           Linuxでは実行中のスクリプト自身を含むディレクトリを削除しても、開いたファイル記述子は無効にならないため安全に完走する）。
remove_repo_root() {
  [ -n "$REPO_ROOT" ] && [ "$REPO_ROOT" != "/" ] && [ -f "$REPO_ROOT/install/install.sh" ] || die "取得先（$REPO_ROOT）が想定と異なるため、削除を中止します"
  cd /tmp
  rm -rf "$REPO_ROOT"
  log "ソース一式を削除しました（$REPO_ROOT）"
}

# 目的: アンインストールの全体。記録済みのトポロジーに基づき、このホストがオーケストレーターであれば
#      リモートホストの後始末も行ってから、このホスト自身の後始末を行う（specs/design.md「アンインストール（分離構成）」）。
# 挙動: トポロジー記録（.envのTOPOLOGY_RECORDED）が無いホストで実行した場合は、警告のうえローカルの後始末のみ行う
#      （他ホストへの認証情報・到達性を前提にできないため）。
uninstall_main() {
  [ "$(id -u)" -eq 0 ] || die "root権限で実行してください（例: sudo sh $0 --uninstall）"
  log "アンインストールを開始します"
  if [ "$(env_get TOPOLOGY_RECORDED)" = "1" ]; then
    ROLE_HOST_web=$(env_get TOPOLOGY_WEB_HOST)
    ROLE_HOST_api=$(env_get TOPOLOGY_API_HOST)
    ROLE_HOST_gateway=$(env_get TOPOLOGY_GATEWAY_HOST)
    keep_flag=""
    [ "$KEEP_DATA" -eq 0 ] || keep_flag=" --keep-data"
    for host in $(distinct_remote_hosts); do
      log "リモートホスト $host の後始末を実行"
      # shellcheck disable=SC2086
      $SSH_AS ssh $SSH_OPTS "$SSH_USER@$host" "cd $REMOTE_INSTALL_DIR && sudo sh install/install.sh --uninstall$keep_flag" \
        || log "リモートホスト $host の後始末に失敗しました（続行します）"
    done
  else
    log "警告: このホストにはオーケストレーターとしてのトポロジー記録がありません。ローカルの後始末のみ行います（他ホストへはアクセスしません）"
  fi

  uninstall_stack
  uninstall_boot_guard
  uninstall_sysctl
  uninstall_gateway_pki
  uninstall_host_hooks
  echo
  log "アンインストール完了（このホスト）"
  echo "  残っているもの（対象外。手動で削除する場合はREADME.md「アンインストール」参照）:"
  echo "    - Docker本体・依存パッケージ、Dockerの公式リポジトリ設定"
  [ "$KEEP_DATA" -eq 0 ] || echo "    - ベンダーのログイン情報（Dockerボリューム。--keep-data により保持）"
  remove_repo_root
}

# 目的: エントリポイント。
# 入力: スクリプトの引数。
main() {
  parse_args "$@"
  if [ "$UNINSTALL" -eq 1 ]; then
    uninstall_main
    return 0
  fi
  if [ -n "$ONLY_ROLES_ARG" ]; then
    # リモート実行専用の内部経路（オーケストレーターがssh経由で1ホスト分のロールに限定して呼び出す）。
    install_roles "$ONLY_ROLES_ARG"
    return 0
  fi
  orchestrate_main
}

# 検査（install/tests/run.sh）が各関数だけを読み込めるよう、VPNGW_INSTALL_LIB が設定されていれば main を実行しない。
if [ -z "${VPNGW_INSTALL_LIB:-}" ]; then
  main "$@"
fi
