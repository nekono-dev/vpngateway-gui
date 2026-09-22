#!/bin/sh
# 責務: クリーンなDebian系ベアメタル（Debian・Raspberry Pi OS・Ubuntu）へ、プラットフォーム（web・api・proxy）と、有効にしたVPNベンダーの
# ランナーを導入・起動する本体インストーラ。1本で完結し、冪等（再実行は更新・ベンダーの変更・修復を兼ねる）。
# 通常は頒布されるブートストラップ（install/bootstrap.sh）が、ソースの取得後にこのスクリプトを呼ぶ。手動でcloneした場合は直接実行してよい。
# 設計: specs/design.md「インストーラと頒布（Phase 13）」、要件: specs/requirements.md「インストール」。
#
# 処理の概要（順に実行）:
#   1. 事前検査（root・Debian系・systemd・CPU）  2. 共通の依存パッケージとDocker（公式リポジトリ）
#   3. ホストの設定（IPフォワーディング・起動時のKill Switchガード）  4. .envの作成・更新（LAN側IF・有効なベンダー・composeの合成）
#   5. ベンダー固有のホスト側手順（vendors/<ID>/install-host.sh。あるベンダーだけ）  6. 起動と待機  7. 完了の表示
# --uninstall指定時は上記を行わず、代わりにこのインストーラが導入・作成したものを後始末する（下記「--uninstall」参照）。
#
# 使い方（root権限で）: sh install/install.sh --providers <ID>[,<ID>...] [--web-port <番号>] [--lan-iface <名前>] [--redetect-lan-iface] [--no-start]
#   --providers            有効にするベンダー（vendors/<ID>/ のディレクトリ名）。省略時は、その時点でvendors/にある全ベンダー（all）を有効にする
#                           （新しい版で追加されたベンダーも、再実行のたびに自動的に有効化される）。
#   --web-port             Web UIを配信するホスト側のポート番号（1〜65535）。省略時は、.envの既存値（無ければ80）を使う。
#   --lan-iface            LAN側インターフェース名を指定する（自動検出できない・複数NICの場合）。
#   --redetect-lan-iface   保存済みのLAN側インターフェース名を捨てて再検出する。
#   --no-start             起動（docker compose up）をしない。
# 例: sudo sh install/install.sh --providers vendora,vendorb
#
# 使い方（アンインストール、root権限で）: sh install/install.sh --uninstall [--keep-data]
#   --uninstall            docker composeスタックの停止・削除（既定でボリューム＝ベンダーのログイン情報も削除）、IPフォワーディング設定、
#                           起動時のKill Switchガード、有効なベンダーのホスト側の後始末（vendors/<ID>/uninstall-host.sh。あるベンダーだけ）、
#                           ソース一式の取得先ディレクトリ（自分自身）の削除を行う。Docker本体・apt依存パッケージは対象外（手動で削除すること。README.md参照）。
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

PROVIDERS_ARG=""
WEB_PORT_ARG=""
LAN_IFACE_ARG=""
REDETECT_LAN=0
NO_START=0
UNINSTALL=0
KEEP_DATA=0

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
      --no-start) NO_START=1; shift ;;
      --uninstall) UNINSTALL=1; shift ;;
      --keep-data) KEEP_DATA=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "不明な引数です: $1（--help で使い方を表示）" ;;
    esac
  done
  [ "$KEEP_DATA" -eq 0 ] || [ "$UNINSTALL" -eq 1 ] || die "--keep-data は --uninstall と併用してください"
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
# 副作用: /etc/sysctl.d/99-vpngwgui.conf を作成し、その設定だけをsysctlへ反映する。
setup_sysctl() {
  cat > "$SYSCTL_FILE" <<'EOSYSCTL'
# vpngateway-gui: LAN機器への透過ゲートウェイ提供に必要なIPフォワーディング設定。
# install/install.shにより作成された。手動で削除・変更しないこと。
net.ipv4.ip_forward=1
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

# 目的: 有効にするベンダーを決め、.envのVPN_PROVIDERSとCOMPOSE_FILE（有効なバンドルのfragmentの合成）を書く。
# 入力: グローバル変数 PROVIDERS_ARG。
# 出力: グローバル変数 PROVIDERS（カンマ区切り）・PROVIDER_IDS（空白区切り）。
# 優先順: --providers ＞ その時点でvendors/にある全ベンダー（all）。.envの既存のVPN_PROVIDERSは参照しない
#         （初回導入・アップデートのどちらでも同じ規則にし、新しく追加されたベンダーが再実行のたびに自動的に有効化されるようにする）。
# 失敗時: 形式不正・バンドルが無い・重複の場合、または有効にできるベンダーが1つも無い場合は終了する。
setup_providers() {
  if [ -n "$PROVIDERS_ARG" ]; then
    PROVIDERS=$PROVIDERS_ARG
  else
    PROVIDERS=$(list_bundles | tr '\n' ',')
    PROVIDERS=${PROVIDERS%,}
    [ -n "$PROVIDERS" ] || die "有効にできるベンダーがありません（vendors/ 配下にバンドルがありません）"
  fi
  PROVIDER_IDS=$(printf '%s' "$PROVIDERS" | tr ',' ' ')
  files="docker-compose.yml"
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
    files="$files:vendors/$id/compose.yml"
  done
  PROVIDERS=$(printf '%s' "$PROVIDER_IDS" | tr ' ' ',')
  env_set VPN_PROVIDERS "$PROVIDERS"
  env_set COMPOSE_FILE "$files"
  env_unset COMPOSE_PROFILES
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

# 目的: docker compose でスタックを（再）ビルド・起動し、Web UIが応答するまで待つ。
# 副作用: イメージのビルド・コンテナの作成。無効にしたベンダーのランナーは--remove-orphansで停止・削除される（ログイン情報のボリュームは残る）。
# 失敗時: Web UIが約3分待っても応答しなければ終了する。
start_stack() {
  cd "$REPO_ROOT"
  log "起動（docker compose up -d --build --remove-orphans。初回はビルドに時間がかかります）"
  docker compose up -d --build --remove-orphans
  log "Web UIの応答を待機"
  waited=0
  until curl -fsS -m 3 "http://127.0.0.1:$WEB_PORT/api/v1/providers" >/dev/null 2>&1; do
    waited=$((waited + 3))
    [ "$waited" -lt 180 ] || die "Web UIが応答しません。docker compose logs で確認してください（$REPO_ROOT）"
    sleep 3
  done
}

# 目的: 完了を表示し、次の操作を案内する。
finish() {
  addr=$(ip -4 -o addr show dev "$LAN_IFACE" 2>/dev/null | awk '{ sub("/.*", "", $4); print $4 }' | head -n 1)
  echo
  log "完了"
  echo "  Web UI:        http://${addr:-<このホストのアドレス>}:$WEB_PORT"
  echo "  有効なベンダー: $PROVIDERS"
  echo "  次の操作:      Web UIを開き、ベンダーごとにログインする。LAN機器のデフォルトゲートウェイをこのホストへ向ける。"
  echo "  設定の変更:    sudo sh $REPO_ROOT/install/install.sh --providers <ID>,...（同じ操作の再実行で、有効なベンダーを変更できる）"
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
    rm -f "$SYSCTL_FILE"
    sysctl -w net.ipv4.ip_forward=0 >/dev/null 2>&1 || true
    log "IPフォワーディングの設定: 削除しました（$SYSCTL_FILE）"
  else
    log "IPフォワーディングの設定: 対象なし"
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

# 目的: アンインストールの全体（上の各段階を順に実行する）。mainから--uninstall指定時に呼ばれる。
uninstall_main() {
  [ "$(id -u)" -eq 0 ] || die "root権限で実行してください（例: sudo sh $0 --uninstall）"
  log "アンインストールを開始します"
  uninstall_stack
  uninstall_boot_guard
  uninstall_sysctl
  uninstall_host_hooks
  echo
  log "アンインストール完了"
  echo "  残っているもの（対象外。手動で削除する場合はREADME.md「アンインストール」参照）:"
  echo "    - Docker本体・依存パッケージ、Dockerの公式リポジトリ設定"
  [ "$KEEP_DATA" -eq 0 ] || echo "    - ベンダーのログイン情報（Dockerボリューム。--keep-data により保持）"
  remove_repo_root
}

# 目的: インストールの全体（上の各段階を順に実行する）。
# 入力: スクリプトの引数。
main() {
  parse_args "$@"
  if [ "$UNINSTALL" -eq 1 ]; then
    uninstall_main
    return 0
  fi
  preflight
  install_packages
  install_docker
  setup_sysctl
  setup_lan_iface
  setup_web_port
  setup_boot_guard
  setup_providers
  run_host_hooks
  if [ "$NO_START" -eq 1 ]; then
    log "--no-start のため起動しません（起動: cd $REPO_ROOT && docker compose up -d --build --remove-orphans）"
  else
    start_stack
  fi
  finish
}

# 検査（install/tests/run.sh）が各関数だけを読み込めるよう、VPNGW_INSTALL_LIB が設定されていれば main を実行しない。
if [ -z "${VPNGW_INSTALL_LIB:-}" ]; then
  main "$@"
fi
