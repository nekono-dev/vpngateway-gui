# 責務: ベンダーバンドル（vendors/<ID>/・e2e/vendors/<ID>/）を使うE2E（docker-compose.e2e-mock.yml）の準備。
# 実運用のバンドル（vendors/）とE2E用のモックバンドル（e2e/vendors/）を、本番と同じ方式（COMPOSE_FILEの合成＋VPN_PROVIDERS）で併せる。
# 読み取り専用のバインドマウントの中へ別の場所のファイルを重ねられないため、APIへは、有効なベンダーのプロファイルだけを集めた
# 一時ディレクトリを渡す（E2E_VENDORS_DIR）。
#
# 使い方: . e2e/lib/e2e-vendors.sh
#         make_e2e_vendors_dir adguardvpn mockproton   # E2E_VENDORS_DIR・VPN_PROVIDERSをexportする（呼び出し側が終了時にrm -rf "$E2E_VENDORS_DIR"する）
#         DC="docker compose -p <project> $(e2e_compose_files adguardvpn mockproton)"

E2E_LIB_ROOT=$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

# 目的: ベンダーバンドルのディレクトリを返す（E2E用のモックがあればそちら、無ければ実運用のバンドル）。
# 入力: id(ベンダーID)。 出力: リポジトリルートからの相対パス。
e2e_bundle_dir() {
  if [ -d "$E2E_LIB_ROOT/e2e/vendors/$1" ]; then echo "e2e/vendors/$1"; else echo "vendors/$1"; fi
}

# 目的: 有効なベンダーのプロファイルを集めた一時ディレクトリを作り、E2E_VENDORS_DIRとVPN_PROVIDERSをexportする。
# 入力: id...(有効にするベンダーID)。
make_e2e_vendors_dir() {
  E2E_VENDORS_DIR=$(mktemp -d)
  local id
  for id in "$@"; do
    mkdir "$E2E_VENDORS_DIR/$id"
    cp "$E2E_LIB_ROOT/$(e2e_bundle_dir "$id")/profile.json" "$E2E_VENDORS_DIR/$id/profile.json"
    chmod 755 "$E2E_VENDORS_DIR/$id"
    chmod 644 "$E2E_VENDORS_DIR/$id/profile.json"
  done
  # コンテナ内の非root（UID 10001）が読めるようにする（mktemp -dは0700で作られるため）。
  chmod 755 "$E2E_VENDORS_DIR"
  VPN_PROVIDERS=$(IFS=,; echo "$*")
  export E2E_VENDORS_DIR VPN_PROVIDERS
}

# 目的: `docker compose`へ渡す-f引数（本体・3ロール分・E2E用のoverride・有効なベンダーのfragment）を返す。
# パスはリポジトリルート基準の相対（docker-compose.ymlを先頭に置くことで、docker composeのproject
# directoryをリポジトリルートへ固定する。docker-compose.yml冒頭のコメント参照）。
# 入力: id...(有効にするベンダーID)。
e2e_compose_files() {
  local args="-f docker-compose.yml -f compose/web.yml -f compose/api.yml -f compose/gateway.yml -f docker-compose.e2e-mock.yml" id
  for id in "$@"; do args="$args -f $(e2e_bundle_dir "$id")/compose.yml"; done
  echo "$args"
}
