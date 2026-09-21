# 責務: ゲートウェイ役に対するコマンド実行・ファイル転送を、GW_MODE（lxc/ssh）の違いを隠蔽して提供する。
# 前提: 先に lxc/env.sh を読み込んでいること。
#
# gw <cmd...>            : ゲートウェイ役の$GW_REPO_DIRで（ssh時はsudo付きで）コマンドを実行する
# gw_push <ローカル> <リモート絶対パス> : ファイルをゲートウェイ役へ転送する（ssh時はscp）
# gw_lan_ip              : ゲートウェイ役のLAN側IPv4アドレスを標準出力へ出す
# 例: gw docker compose ps

gw() {
  if [ "$GW_MODE" = ssh ]; then
    # 引数を再クォートしてリモートシェルへ渡す（bash -c "..." 等の複雑な引数も壊さないため）
    # shellcheck disable=SC2046
    ssh $SSH_OPTS "$GW_SSH" "cd $GW_REPO_DIR 2>/dev/null; sudo $(printf '%q ' "$@")"
  else
    lxc exec "$GW_NAME" --cwd "$GW_REPO_DIR" -- "$@"
  fi
}

gw_push() {
  if [ "$GW_MODE" = ssh ]; then
    # shellcheck disable=SC2086
    scp $SSH_OPTS -q "$1" "$GW_SSH:/tmp/$(basename "$2")" && ssh $SSH_OPTS "$GW_SSH" "sudo mv /tmp/$(basename "$2") $2"
  else
    lxc file push "$1" "$GW_NAME$2" >/dev/null
  fi
}

gw_lan_ip() {
  gw ip -4 -o addr show "$GW_LAN_IF" | awk '{sub("/.*","",$4); print $4}' | head -n1
}
