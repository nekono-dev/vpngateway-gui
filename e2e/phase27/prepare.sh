#!/bin/bash
# 責務: Phase 14のLXDラボ（e2e/phase14/lab.sh）に、Phase 27（設定の動作検証）の検証に必要なものを追加する（冪等）。
#   - 宛先サーバ（p14-target）に、HTTPSのIP確認サービス（echo-server.py。203.0.113.20:8443）を起動する
#   - ゲートウェイ役（p14-gw）のproxyコンテナに、そのサービスの証明書を発行したCAを信頼させる（コンテナの再作成のたびに必要）
#   - LAN端末役（p14-client）に、Node・Playwright（Chromium）を入れる（Web UIを、LAN端末のブラウザとして操作するため）
# 実行: 検証サーバ上で `bash e2e/phase27/prepare.sh [echo|trust|browser ...]`（省略時はすべて）。先に lab.sh create と、
#       p14-gwへのインストール（`sh install/setup.sh --providers <ID> --web-port 8080`）を済ませておくこと。
set -eu
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ECHO_IP=203.0.113.20
ECHO_PORT=8443
PKI=/tmp/p27-echo
NODE_VERSION=v22.16.0
PLAYWRIGHT_VERSION=1.63.0
ONLY="$*"
want() { [ -z "$ONLY" ] || [[ " $ONLY " == *" $1 "* ]]; }

if want echo; then
  mkdir -p "$PKI"
  if [ ! -f "$PKI/ca.pem" ]; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 7 -keyout "$PKI/ca.key" -out "$PKI/ca.pem" -subj "/CN=p27 echo CA" 2>/dev/null
    openssl req -newkey rsa:2048 -nodes -keyout "$PKI/key.pem" -out "$PKI/req.csr" -subj "/CN=$ECHO_IP" 2>/dev/null
    printf 'subjectAltName=IP:%s\n' "$ECHO_IP" > "$PKI/ext.cnf"
    openssl x509 -req -in "$PKI/req.csr" -CA "$PKI/ca.pem" -CAkey "$PKI/ca.key" -CAcreateserial -days 7 -extfile "$PKI/ext.cnf" -out "$PKI/cert.pem" 2>/dev/null
  fi
  lxc exec p14-target -- sh -c "ip addr show dev eth0 | grep -q ' $ECHO_IP/' || ip addr add $ECHO_IP/24 dev eth0"
  lxc file push "$HERE/echo-server.py" p14-target/root/echo-server.py >/dev/null
  lxc file push "$PKI/cert.pem" p14-target/root/echo-cert.pem >/dev/null
  lxc file push "$PKI/key.pem" p14-target/root/echo-key.pem >/dev/null
  lxc exec p14-target -- sh -c "systemctl stop p27-echo 2>/dev/null; systemd-run --unit=p27-echo python3 /root/echo-server.py $ECHO_IP $ECHO_PORT /root/echo-cert.pem /root/echo-key.pem >/dev/null"
  echo "IP確認サービス: https://$ECHO_IP:$ECHO_PORT （CA: $PKI/ca.pem）"
fi

if want trust; then
  lxc file push "$PKI/ca.pem" p14-gw/root/p27-echo-ca.pem >/dev/null
  lxc exec p14-gw --cwd /opt/vpngwgui -- sh -c 'docker compose cp /root/p27-echo-ca.pem proxy:/tmp/p27-echo-ca.pem >/dev/null &&
    docker compose exec -T -u root proxy sh -c "grep -q \"p27 echo CA\" /etc/ssl/certs/ca-certificates.crt 2>/dev/null || { echo \"# p27 echo CA\" >> /etc/ssl/certs/ca-certificates.crt; cat /tmp/p27-echo-ca.pem >> /etc/ssl/certs/ca-certificates.crt; }"'
  echo "proxyコンテナにIP確認サービスのCAを信頼させた"
fi

if want browser; then
  # 導入の間だけ、LAN端末役の経路をルータ直通（インターネットへ出られる）にする。
  lxc exec p14-client -- sh -c "
    set -e
    ip route replace default via 10.98.1.1 dev eth0
    printf 'nameserver 1.1.1.1\n' > /etc/resolv.conf
    if [ ! -x /opt/node/bin/node ]; then
      curl -fsSL https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz -o /tmp/node.tar.xz
      mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
    fi
    export PATH=/opt/node/bin:\$PATH
    npm ls -g playwright >/dev/null 2>&1 || npm i -g --silent playwright@$PLAYWRIGHT_VERSION
    npx --yes playwright@$PLAYWRIGHT_VERSION install --with-deps chromium >/tmp/playwright-install.log 2>&1
    ip route replace default via 10.98.1.10 dev eth0
  "
  echo "LAN端末役にPlaywright（Chromium）を導入した"
fi
