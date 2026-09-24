# ネットワークコンテナ（`proxy`）のイメージ。透過ゲートウェイ（nftables）・Kill Switch・明示的プロキシ（3proxy）・
# トンネル検出・接続監視のみを担い、**ベンダーCLIを含まない**（Phase 11でランナーへ分離。
# specs/proxyserver/design.md「コンテナ構成（Phase 11）」）。ベンダーCLIの実行環境は`Dockerfile.runner-<ベンダー>`。

# ビルドステージ: npm workspacesの依存解決のためリポジトリルートをbuild contextとする
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY web/package.json web/package.json
COPY api/package.json api/package.json
COPY proxy/package.json proxy/package.json
RUN npm ci
COPY proxy proxy
COPY tsconfig.base.json tsconfig.base.json
RUN npm run build -w proxy

# ビルドステージ: 明示的プロキシ用の3proxyをソースからビルドする（Phase 4）。
# Alpineの安定版リポジトリ（main/community）に3proxyパッケージが無く、edge/testingのバイナリは
# 実行ステージのlibcと版が食い違いうるため、公式リリースのソースを固定バージョンでビルドする
# （動的リンクはmuslのみ。ビルド時のみネットワークアクセスが必要で、実行イメージにはバイナリ1つだけを渡す）。
FROM alpine:3.24 AS proxy-build
# 動作確認済みバージョンを固定する。更新時はこの値のみを変更する。
ARG THREEPROXY_VERSION=0.9.5
RUN apk add --no-cache build-base curl tar linux-headers \
  && curl -fsSL -o /tmp/3proxy.tar.gz \
       "https://github.com/3proxy/3proxy/archive/refs/tags/${THREEPROXY_VERSION}.tar.gz" \
  && mkdir /src \
  && tar -xzf /tmp/3proxy.tar.gz -C /src --strip-components=1 \
  && make -C /src -f Makefile.Linux \
  && strip /src/bin/3proxy

# 実行ステージ
FROM node:22-alpine
# nftables: 透過ゲートウェイ・Kill Switchのルール操作用（`iptables`ではなく`nft`を直接使う。
# proxyserver/design.md「NAT/FORWARDルール」参照）。iproute2: `ip route get`によるVPNトンネルインターフェース
# 動的検出用（Alpine標準の busybox ip では出力形式が異なりうるため明示的に導入）。
# sudo: nft/ipをvpngwguiから実行するため（cap_add: NET_ADMINを付与していても非root実行では昇格が必要）。
# libcap-utils: nodeに特権ポート（DNS中継の53番）のbind権限だけを与えるため（下のsetcap）。
RUN apk add --no-cache sudo nftables iproute2 libcap-utils \
  && addgroup -g 10001 vpngwgui && adduser -D -u 10001 -G vpngwgui vpngwgui \
  && echo "vpngwgui ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/vpngwgui \
  && chmod 0440 /etc/sudoers.d/vpngwgui
WORKDIR /app
COPY --from=build /repo/proxy/dist ./dist
COPY --from=proxy-build /src/bin/3proxy /usr/local/bin/3proxy
# DNS中継リゾルバは非rootのvpngwguiで53番（特権ポート）をlistenする。network_mode: hostのため、コンテナ側のsysctl
# （net.ipv4.ip_unprivileged_port_start）では変えられないので、nodeバイナリにbind権限（NET_BIND_SERVICE。Dockerの既定の
# capabilityに含まれる）だけをファイルcapabilityで付与する（proxyserver/design.md「DNS中継リゾルバ」）。
RUN setcap cap_net_bind_service=+ep /usr/local/bin/node
RUN mkdir -p /var/run/vpngw-ctl && chown vpngwgui:vpngwgui /var/run/vpngw-ctl
USER vpngwgui
ENV CTL_SOCKET_PATH=/var/run/vpngw-ctl/net.sock
ENV HOME=/home/vpngwgui
CMD ["node", "dist/server.js"]
