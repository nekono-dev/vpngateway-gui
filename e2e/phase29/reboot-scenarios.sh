#!/bin/bash
# 責務: Phase29（ゲートウェイ機＝ベアメタルの再起動）の完了基準を、検証サーバ（GW_MODE=ssh相当の実機）で通しで自動検証する。
# 実際にホストを再起動する（約1〜2分）。検証サーバ上の他のコンテナ・ネットワークも一時的に止まる。
# 手順: 利用者アカウントを退避→E2E共通アカウントで検証→元のアカウントを復元する。
#   A: 誤ったパスワードでは再起動されない（ブート時刻不変・依頼ファイルが残らない）
#   B: 正しいパスワードで依頼が受け付けられ、ホストが再起動する（ブート時刻が変わる）
#   C: 再起動後、依頼ファイルが残らず（再起動を繰り返さない）、スタック（proxy・API）が復旧し、LAN側ガード/ルールが再構成される
#   D: 監査ログに依頼が記録され、パスワードが含まれない
# 使い方: SSHPASS=<パスワード> bash e2e/phase29/reboot-scenarios.sh   （鍵認証済みなら SSHPASS 不要）
# 環境: GW_SSH（既定 ubuntu@192.168.3.240）、WEB_URL（既定 https://192.168.3.240）

set -u
GW_SSH=${GW_SSH:-ubuntu@192.168.3.240}
WEB_URL=${WEB_URL:-https://192.168.3.240}
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5"
FAILS=0

rssh() {
  if [ -n "${SSHPASS:-}" ]; then sshpass -e ssh $SSH_OPTS "$GW_SSH" "$@"; else ssh -o BatchMode=yes $SSH_OPTS "$GW_SSH" "$@"; fi
}
check() { desc=$1; shift; if "$@"; then echo "PASS: $desc"; else echo "FAIL: $desc"; FAILS=$((FAILS + 1)); fi; }

boot_id() { rssh 'cat /proc/sys/kernel/random/boot_id'; }

# 利用者アカウントを退避して、E2E共通アカウントで初期設定できる状態にする。
# 退避先は再起動で消えない場所（ホストの~/）にする（このE2Eはホストを再起動するため、/tmpは使えない）。
# 退避に成功したことを確認できなければ、アカウントを消さずに中止する。
BACKUP='~/operator-account.e2e-backup.json'
if rssh 'sudo docker exec vpngwgui-api-1 test -f /var/lib/vpngwgui/operator-account.json'; then
  rssh "sudo docker cp vpngwgui-api-1:/var/lib/vpngwgui/operator-account.json $BACKUP && test -s $BACKUP" \
    || { echo "FAIL: 利用者アカウントの退避に失敗したため中止します"; exit 1; }
  HAD_ACCOUNT=1
else
  HAD_ACCOUNT=0
fi
rssh 'sudo docker exec vpngwgui-api-1 rm -f /var/lib/vpngwgui/operator-account.json'
# 終了時に、E2E共通アカウントを消し、退避した元のアカウントがあれば戻す（無かったなら未設定状態へ戻す）。
restore_account() {
  rssh 'sudo docker exec vpngwgui-api-1 rm -f /var/lib/vpngwgui/operator-account.json'
  if [ "$HAD_ACCOUNT" = 1 ]; then
    rssh "sudo docker cp $BACKUP vpngwgui-api-1:/var/lib/vpngwgui/operator-account.json && sudo docker exec -u 0 vpngwgui-api-1 chown 10001:10001 /var/lib/vpngwgui/operator-account.json && sudo rm -f $BACKUP"
  fi
}
trap restore_account EXIT

BOOT0=$(boot_id)

echo "== A: 誤ったパスワード"
check "UI: ボタンの配置・警告・誤パスワードのエラー表示" node "$HERE/webgui-phase29.mjs" "$WEB_URL" wrong /tmp/phase29-wrong.png
check "A: ブート時刻が変わらない" test "$(boot_id)" = "$BOOT0"
check "A: 依頼ファイルが残っていない" rssh 'test ! -e /var/lib/vpngwgui-host-ctl/reboot-request'

echo "== B: 正しいパスワードで再起動"
check "UI: 依頼が受け付けられる" node "$HERE/webgui-phase29.mjs" "$WEB_URL" request /tmp/phase29-requested.png

# 再起動で一度切れるのを待ち（最大90秒）、復帰を待つ（最大300秒）。
down=0
for _ in $(seq 1 45); do
  if ! rssh true 2>/dev/null; then down=1; break; fi
  sleep 2
done
check "B: ホストが再起動のため一時的に応答しなくなる" test "$down" = 1
up=0
for _ in $(seq 1 100); do
  if rssh true 2>/dev/null; then up=1; break; fi
  sleep 3
done
check "B: ホストが復帰する" test "$up" = 1
[ "$up" = 1 ] || { echo "== 結果: FAIL ${FAILS} 件（復帰せず）"; exit "$FAILS"; }
check "B: ブート時刻が変わっている（OSが再起動した）" test "$(boot_id)" != "$BOOT0"

echo "== C: 復旧"
check "C: 依頼ファイルが残っていない（再起動を繰り返さない）" rssh 'test ! -e /var/lib/vpngwgui-host-ctl/reboot-request'
check "C: 再起動後もpathユニットが有効" rssh 'systemctl is-active --quiet vpngwgui-reboot.path'
ok=0
for _ in $(seq 1 60); do
  if rssh 'sudo docker ps --format "{{.Names}}" | grep -q "^vpngwgui-proxy-1$" && sudo docker ps --format "{{.Names}}" | grep -q "^vpngwgui-api-1$"' 2>/dev/null; then ok=1; break; fi
  sleep 3
done
check "C: proxy・APIコンテナが復旧する" test "$ok" = 1
rule=0
for _ in $(seq 1 60); do
  if rssh 'sudo nft list table inet vpngwgui >/dev/null 2>&1'; then rule=1; break; fi
  sleep 3
done
check "C: inet vpngwgui テーブルが存在する（起動ガード／proxyの再構成）" test "$rule" = 1
sleep 20
check "C: Web UIが応答する" bash -c "curl -sk -o /dev/null -w '%{http_code}' $WEB_URL/ | grep -q 200"

echo "== D: 監査ログ"
check "D: gateway_rebootが記録されている" rssh 'sudo docker exec vpngwgui-api-1 grep -q "\"action\":\"gateway_reboot\"" /var/lib/vpngwgui/audit.log'
check "D: パスワードが記録されていない" rssh '! sudo docker exec vpngwgui-api-1 grep -q "e2e-password-1234" /var/lib/vpngwgui/audit.log'

echo "== 結果: FAIL ${FAILS} 件"
exit "$FAILS"
