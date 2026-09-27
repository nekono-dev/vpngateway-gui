# 責務: ゲートウェイ役に対するコマンド実行・ファイル転送を、GW_MODE（lxc/ssh/roles）の違いを隠蔽して提供する。
# 前提: 先に lxc/env.sh を読み込んでいること。
#
# gw <cmd...>            : ゲートウェイ役の$GW_REPO_DIRで（ssh時はsudo付きで）コマンドを実行する
# gw_push <ローカル> <リモート絶対パス> : ファイルをゲートウェイ役へ転送する（ssh時はscp）
# gw_lan_ip              : ゲートウェイ役のLAN側IPv4アドレスを標準出力へ出す
# api_role/web_role <cmd...> : api役・web役に対するコマンド実行（GW_MODE=roles、デプロイメント構成の
#                          分離・3台分離構成向け。それ以外のモードではgwへ委譲する＝従来どおり同居前提）
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

# api_role/web_role <cmd...> : api役・web役に対するコマンド実行（デプロイメント構成の分離・3台分離構成、
# GW_MODE=roles向け）。GW_MODE=roles以外では、従来どおりapi・webがgateway役と同居している前提のため
# gwへ委譲する（既存モードの挙動は変えない）。
api_role() {
  if [ "$GW_MODE" = roles ]; then
    lxc exec "$API_NAME" --cwd "$GW_REPO_DIR" -- "$@"
  else
    gw "$@"
  fi
}

web_role() {
  if [ "$GW_MODE" = roles ]; then
    lxc exec "$WEB_NAME" --cwd "$GW_REPO_DIR" -- "$@"
  else
    gw "$@"
  fi
}
