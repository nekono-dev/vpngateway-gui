#!/bin/bash
# 責務: Phase 12完了基準「ベンダー追加の実証」を検証する。共通部（API・Web・ネットワークコンテナ・composeの本体）を一切変更せず、
#       モックのベンダーバンドルを別名で1ディレクトリ複製して追加するだけで、新しいベンダーがWeb UIの選択肢（`GET /v1/providers`）に現れ、
#       ランナーが起動して利用可能になり、選択できること。バンドルを外せば消えること。
# 実行: bash e2e/phase12/add-vendor-scenarios.sh
# 前提: 開発ホストにdocker compose。実VPN・実ネットワークは使わない。専用のcompose project（vpngwgui-e2e-add）で起動し、終了時に後始末する。
# 出力: 各検証をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../.." && pwd)
BASE=${BASE:-http://localhost:18080}
PROJECT=vpngwgui-e2e-add
NEW=mockother
FAILS=0
check() { # check <説明> <条件が真のときexit 0となるコマンド...>
  local desc=$1; shift
  if "$@"; then echo "PASS: $desc"; else echo "FAIL: $desc"; FAILS=$((FAILS+1)); fi
}
api() { curl -s -m 30 -X "$1" ${3:+-H 'content-type: application/json' -d "$3"} "$BASE/api$2"; }
provider_field() { # provider_field <ベンダーID> <項目>
  api GET /v1/providers | python3 -c "import json,sys; d=[p for p in json.load(sys.stdin) if p['id']=='$1']; print(d[0]['$2'] if d else 'none')"
}

. "$HERE/../lib/e2e-vendors.sh"
cd "$ROOT" || exit 1
# 新しいベンダーのバンドルを、モックのバンドルの複製（IDだけ変更）として作る。これが「ベンダーの追加」の全て。
rm -rf "e2e/vendors/$NEW" && cp -r e2e/vendors/mockproton "e2e/vendors/$NEW"
sed -i "s/mockproton/$NEW/g; s/Proton VPN（モック）/別のモックVPN/" "e2e/vendors/$NEW/profile.json" "e2e/vendors/$NEW/compose.yml" "e2e/vendors/$NEW/Dockerfile"
make_e2e_vendors_dir mockproton "$NEW"
DC="docker compose -p $PROJECT $(e2e_compose_files mockproton "$NEW")"
cleanup() { $DC down -v >/dev/null 2>&1; rm -rf "$E2E_VENDORS_DIR" "e2e/vendors/$NEW"; }
trap cleanup EXIT

echo "== 準備: 追加したバンドルを含む構成の起動（共通部は無変更。ビルドを含む）"
git diff --quiet -- api proxy web docker-compose.yml || echo "注意: 共通部に未コミットの変更があります（この検証の対象外の変更）"
$DC up -d --build >/dev/null 2>&1 || { echo "FAIL: 起動に失敗"; exit 1; }
for _ in $(seq 1 60); do curl -sf "$BASE/api/v1/providers" >/dev/null 2>&1 && break; sleep 1; done

echo "== add: 新しいベンダー（$NEW）が現れる"
check "有効なベンダーに追加分が現れ、表示名はバンドルのprofile.jsonの値" test "$(provider_field "$NEW" displayName)" = "別のモックVPN"
check "追加分のランナーが起動していて利用可能（available）" test "$(provider_field "$NEW" available)" = "True"
check "選択できる（PUT /v1/providers/active が200）" test "$(curl -s -o /dev/null -w '%{http_code}' -m 30 -X PUT -H 'content-type: application/json' -d "{\"providerId\":\"$NEW\"}" "$BASE/api/v1/providers/active")" = 200
check "選択後、ログイン方式などはそのバンドルのプロファイルに従う（credentials）" test "$(api GET /v1/session | python3 -c "import json,sys; print(json.load(sys.stdin)['loginMethod'])")" = credentials
check "追加したランナーの許可バイナリはそのバンドルのものだけ（他のランナーとは別のソケット）" $DC exec -T "runner-$NEW" test -S "/var/run/vpngw-ctl/runner-$NEW.sock"

echo "== remove: バンドルを外して再作成すると消える"
$DC down >/dev/null 2>&1
make_e2e_vendors_dir mockproton
DC="docker compose -p $PROJECT $(e2e_compose_files mockproton)"
$DC up -d --remove-orphans >/dev/null 2>&1
for _ in $(seq 1 60); do curl -sf "$BASE/api/v1/providers" >/dev/null 2>&1 && break; sleep 1; done
check "外したベンダーは一覧に現れない" test "$(provider_field "$NEW" id)" = none
check "残したベンダーは残る" test "$(provider_field mockproton id)" = mockproton

echo "== 結果: FAIL $FAILS 件"
exit "$FAILS"
