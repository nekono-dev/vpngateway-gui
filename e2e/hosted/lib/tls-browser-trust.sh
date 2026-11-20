#!/bin/sh
# 責務: hosted TLS 試験の Web CA だけを Chromium の NSS DB で信頼させる。

set -eu

action=${1:?使い方: tls-browser-trust.sh setup|cleanup [証明書ディレクトリ]}
cert_dir=${2:-e2e/hosted/.work/tls-matrix}
nss_db=${HOME:?HOME が必要です}/.pki/nssdb
marker_file=$cert_dir/browser-trust-registration

certificate_fingerprint() {
  openssl x509 -in "$1" -noout -fingerprint -sha256 | sed 's/^[^=]*=//'
}

nss_fingerprint() {
  certutil -L -d "sql:$nss_db" -n "$1" -a | openssl x509 -noout -fingerprint -sha256 | sed 's/^[^=]*=//'
}

case "$action" in
  setup)
    mkdir -p "$nss_db"
    if [ ! -f "$nss_db/cert9.db" ]; then
      certutil -N --empty-password -d "sql:$nss_db"
    fi
    mkdir -p "$cert_dir"
    cert_name=vpngwgui-e2e-web-ca-$$
    while certutil -L -d "sql:$nss_db" -n "$cert_name" >/dev/null 2>&1; do
      cert_name=$cert_name-x
    done
    fingerprint=$(certificate_fingerprint "$cert_dir/web/ca.crt")
    certutil -A -d "sql:$nss_db" -t "C,," -n "$cert_name" -i "$cert_dir/web/ca.crt"
    printf '%s\t%s\n' "$cert_name" "$fingerprint" > "$marker_file"
    ;;
  cleanup)
    if [ -f "$marker_file" ] && [ -f "$nss_db/cert9.db" ]; then
      read -r cert_name expected_fingerprint < "$marker_file" || true
      if [ -n "${cert_name:-}" ] && [ -n "${expected_fingerprint:-}" ] &&
        actual_fingerprint=$(nss_fingerprint "$cert_name" 2>/dev/null) &&
        [ "$actual_fingerprint" = "$expected_fingerprint" ]; then
        certutil -D -d "sql:$nss_db" -n "$cert_name"
      fi
    fi
    rm -f "$marker_file"
    ;;
  *)
    echo "不明な操作です: $action" >&2
    exit 2
    ;;
esac
