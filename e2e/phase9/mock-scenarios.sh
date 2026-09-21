#!/bin/bash
# 責務: Phase 9完了基準（wbs/phase9.md）のうち、プロバイダ抽象化基盤（操作の実行可否によるUI制限・入力型ログイン・
#       プラン制限の学習・秘密情報が残らないこと）を、モックプロバイダCLI（Proton VPN公式CLIの挙動を模擬）で検証する。
# 実行: bash e2e/phase9/mock-scenarios.sh
# 前提: 開発ホストにdocker compose・Node・Playwright（e2e/README.md）。実VPN・実ネットワークは使わない。
#       専用のcompose project（vpngwgui-e2e-mock）で起動し、終了時に後始末（down -v）する。Web UIは http://localhost:18080。
# 出力: 各検証をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../.." && pwd)
BASE=${BASE:-http://localhost:18080}
PROJECT=vpngwgui-e2e-mock
DC="docker compose -p $PROJECT -f $ROOT/docker-compose.yml -f $ROOT/docker-compose.e2e-mock.yml"
. "$HERE/../lib/e2e-profiles.sh"
make_e2e_profiles_dir
FAILS=0
gui() { node "$HERE/webgui-provider.mjs" "$BASE" "$@" || FAILS=$((FAILS+1)); }
check() { # check <説明> <条件が真のときexit 0となるコマンド...>
  local desc=$1; shift
  if "$@"; then echo "PASS: $desc"; else echo "FAIL: $desc"; FAILS=$((FAILS+1)); fi
}
cleanup() { $DC down -v >/dev/null 2>&1; rm -rf "$E2E_PROFILES_DIR"; }
trap cleanup EXIT

echo "== 準備: モックプロバイダ構成の起動（ビルドを含む）"
$DC up -d --build >/dev/null 2>&1 || { echo "FAIL: 起動に失敗"; exit 1; }
for _ in $(seq 1 60); do curl -sf "$BASE/api/v1/session" >/dev/null 2>&1 && break; sleep 1; done

echo "== unauth: 未ログイン（接続が理由付きで無効・ログインフォーム）"
gui unauth
echo "== free: 無料アカウント（一覧が理由の枠・自動接続）"
gui free
echo "== paid: 有料アカウント（国単位の一覧・ping無し・接続先変更）"
gui paid
echo "== twofa: 2段階認証"
gui twofa

echo "== learned: 判定では有料に見えるが実行すると無料版の制限に当たる（実行失敗からの学習）"
$DC exec -T runner-mock /usr/local/bin/protonvpn-mock signout >/dev/null
printf 'mock-pass\n' | $DC exec -T runner-mock /usr/local/bin/protonvpn-mock signin free@example.com >/dev/null 2>&1
$DC exec -T runner-mock /usr/local/bin/protonvpn-mock mock-set-probe-plan paid >/dev/null
# ログイン状態のキャッシュ（30秒）を確実に更新させるため、APIのログアウト→CLI直ログインではなく、経過を待つ。
sleep 31
gui learned

echo "== secrets: パスワード・2FAコードが各種ログに残らない"
# ログは大きくなりうる（ポーリングのリクエストログ等）ため、コマンドライン引数ではなくファイルへ書き出してgrepする。
LOGS_FILE=$(mktemp)
AUDIT_FILE=$(mktemp)
$DC logs >"$LOGS_FILE" 2>&1
$DC exec -T api cat /var/lib/vpngwgui/audit.log >"$AUDIT_FILE" 2>/dev/null
check "コンテナのログ（web/api/proxy/runner）にパスワードが無い" bash -c '! grep -q "mock-pass" "$0"' "$LOGS_FILE"
check "コンテナのログに2FAコードが無い" bash -c '! grep -qw "123456" "$0"' "$LOGS_FILE"
check "APIの監査ログにパスワード・2FAコードが無く、ユーザー名は記録される" bash -c '! grep -q "mock-pass" "$0" && ! grep -qw "123456" "$0" && grep -q "free@example.com" "$0"' "$AUDIT_FILE"
check "ランナーの監査ログはstdinの有無のみ記録する" bash -c 'grep -q "stdinProvided" "$0"' "$LOGS_FILE"
rm -f "$LOGS_FILE" "$AUDIT_FILE"

echo "== 結果: FAIL=$FAILS"
exit "$FAILS"
