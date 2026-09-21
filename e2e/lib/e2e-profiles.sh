# 責務: モックランナーを使うE2E（docker-compose.e2e-mock.yml）用に、プロファイルを集めた一時ディレクトリを作る。
# 実運用のプロファイル（api/config/profiles/*.json）とテスト用プロファイル（mockproton）を併せる。
# 読み取り専用のバインドマウントの中へ単一ファイルを重ねられないため、composeへはディレクトリごと渡す。
#
# 使い方: . e2e/lib/e2e-profiles.sh; make_e2e_profiles_dir   # E2E_PROFILES_DIRをexportし、終了時に削除するtrapを設定しない
#         （呼び出し側が`rm -rf "$E2E_PROFILES_DIR"`する）

make_e2e_profiles_dir() {
  local root
  root=$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
  E2E_PROFILES_DIR=$(mktemp -d)
  cp "$root"/api/config/profiles/*.json "$E2E_PROFILES_DIR"/
  cp "$root/api/test-fixtures/profiles/mockproton.json" "$E2E_PROFILES_DIR/mockproton.json"
  # コンテナ内の非root（UID 10001）が読めるようにする（mktemp -dは0700で作られるため）。
  chmod 755 "$E2E_PROFILES_DIR"
  chmod 644 "$E2E_PROFILES_DIR"/*.json
  export E2E_PROFILES_DIR
}
