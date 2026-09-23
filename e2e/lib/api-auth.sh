# 責務: E2Eシェルスクリプトが直接curlでAPIを呼ぶ際の認証（Phase25でAPIが全`/v1/*`にセッションCookieを
# 要求するようになったため）。ブラウザ操作を伴わないシェルベースのE2E（*-scenarios.sh）向けに、
# e2e/lib/playwright.mjsのブラウザ側と同じE2E共通アカウントでの初回作成・ログインと、検証後に
# アカウントを消して「インストール直後の未設定状態」へ戻す後始末を提供する。
#
# ローカル（orchestrating host）からcurlで直接APIサーバへ到達できる場合:
#   . lib/api-auth.sh; e2e_api_login "$BASE"; curl -b "$E2E_COOKIE_JAR" ...
# ゲートウェイ役の上でcurlを実行する場合（gw.shの`gw`経由。先に`. lib/gw.sh`していること）:
#   gw_api_login; gw curl -b "$GW_COOKIE_JAR" ...
#
# 後始末（検証環境をインストール直後の未設定状態へ戻す。gw.shの`gw`経由、ゲートウェイ役の永続環境向け）:
#   reset_operator_account
# ephemeralなdocker compose project（`docker compose down -v`で volume ごと消える構成。phase7/8/10等）では、
# アカウント（`$STATE_DIR/operator-account.json`）もvolumeと一緒に消えるため呼ぶ必要が無い。

E2E_API_USERNAME=e2e-admin
E2E_API_PASSWORD=e2e-password-1234
E2E_COOKIE_JAR=$(mktemp)
GW_COOKIE_JAR=/tmp/vpngwgui-e2e-cookie.txt

# 目的: 指定したベースURLのAPIへ、E2E共通アカウントでログインする（未作成なら作成、作成済みならログインのみ。
#      いずれも失敗してよい。例えば既に他のE2Eユーザー名で作成済みの場合は後続のAPI呼び出しが401になり、
#      その時点でスクリプト側の検証が失敗として検出する）。
# 入力: base(例 "http://192.168.3.240:8080")
# 副作用: E2E_COOKIE_JARへセッションCookieを保存する。
e2e_api_login() {
  local base=$1
  curl -sk -m 30 -c "$E2E_COOKIE_JAR" -X POST -H 'content-type: application/json' \
    -d "{\"username\":\"$E2E_API_USERNAME\",\"password\":\"$E2E_API_PASSWORD\"}" "$base/api/v1/operator" >/dev/null
  curl -sk -m 30 -c "$E2E_COOKIE_JAR" -X POST -H 'content-type: application/json' \
    -d "{\"username\":\"$E2E_API_USERNAME\",\"password\":\"$E2E_API_PASSWORD\"}" "$base/api/v1/operator/session" >/dev/null
}

# 目的: ゲートウェイ役自身の上（`gw`経由）でcurlがAPIへ到達する際の認証。
# 副作用: ゲートウェイ役の$GW_COOKIE_JARへセッションCookieを保存する。
gw_api_login() {
  gw sh -c "curl -sk -c $GW_COOKIE_JAR -X POST -H 'content-type: application/json' -d '{\"username\":\"$E2E_API_USERNAME\",\"password\":\"$E2E_API_PASSWORD\"}' https://localhost:8080/api/v1/operator >/dev/null; curl -sk -c $GW_COOKIE_JAR -X POST -H 'content-type: application/json' -d '{\"username\":\"$E2E_API_USERNAME\",\"password\":\"$E2E_API_PASSWORD\"}' https://localhost:8080/api/v1/operator/session >/dev/null"
}

# 目的: ゲートウェイ役の永続環境から、E2Eで作成したWeb UI利用者アカウントを消し、
#      「インストール直後の未設定状態」（初期設定画面が出る状態）へ戻す。
# 副作用: ゲートウェイ役の`$STATE_DIR/operator-account.json`・Cookie一時ファイルを削除する。
reset_operator_account() {
  gw docker compose exec -T api rm -f /var/lib/vpngwgui/operator-account.json
  gw rm -f "$GW_COOKIE_JAR"
}

# 目的: ローカルのCookie一時ファイルを削除する（呼び出し元スクリプトの後始末から呼ぶ）。
e2e_api_cleanup() {
  rm -f "$E2E_COOKIE_JAR"
}
