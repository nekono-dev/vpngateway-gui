# shellcheck shell=sh disable=SC2154

app_check() {
  _oldifs=$IFS; IFS=','
  for _id in $(config_value PROVIDERS); do
    case "$_id" in ""|*[!a-z0-9]*) IFS=$_oldifs; die "不正なベンダーID: $_id" ;; esac
    [ "${#_id}" -le 32 ] || { IFS=$_oldifs; die "ベンダーIDが長すぎます: $_id"; }
    [ -f "$DIR/vendors/$_id/profile.json" ] && [ -f "$DIR/vendors/$_id/compose.yml" ] \
      || { IFS=$_oldifs; die "ベンダーバンドルがありません（profile.json・compose.yml が必要）: vendors/$_id/"; }
  done
  IFS=$_oldifs
  for _k in PROVIDERS WEB_PORT LAN_IFACE WEB_HOST API_HOST GATEWAY_HOST; do
    case "$(config_value "$_k")" in
      *[!A-Za-z0-9.,:_-]*) die "$_k に使えない文字が含まれます: $(config_value "$_k")" ;;
    esac
  done
  _port=$(config_value WEB_PORT)
  if [ -n "$_port" ]; then
    case "$_port" in *[!0-9]*) die "不正なポート番号です: $_port" ;; esac
    [ "$_port" -ge 1 ] && [ "$_port" -le 65535 ] || die "不正なポート番号です: $_port（1〜65535で指定してください）"
  fi
}

setup_args() {
  # shellcheck source=/dev/null
  . "$CONF_FILE"
  _args=''
  [ -z "${PROVIDERS:-}" ] || _args="$_args --providers $PROVIDERS"
  [ -z "${WEB_PORT:-}" ] || _args="$_args --web-port $WEB_PORT"
  [ -z "${LAN_IFACE:-}" ] || _args="$_args --lan-iface $LAN_IFACE"
  [ -z "${WEB_HOST:-}" ] || _args="$_args --web $WEB_HOST"
  [ -z "${API_HOST:-}" ] || _args="$_args --api $API_HOST"
  [ -z "${GATEWAY_HOST:-}" ] || _args="$_args --gateway $GATEWAY_HOST"
  case "$_args" in
    *[!A-Za-z0-9.,:_\ -]*) die "設定値に使えない文字が含まれます（$CONF_FILE）" ;;
  esac
  printf '%s' "$_args"
}

app_install() {
  _args=$(setup_args)
  # shellcheck disable=SC2086
  sh "$SCRIPT_DIR/setup.sh" $_args
}

app_uninstall() {
  [ -f "$SCRIPT_DIR/setup.sh" ] || return 0
  if [ -n "$PURGE" ]; then
    sh "$SCRIPT_DIR/setup.sh" --uninstall
  else
    sh "$SCRIPT_DIR/setup.sh" --uninstall --keep-data
  fi
}

app_purge() {
  :
}
