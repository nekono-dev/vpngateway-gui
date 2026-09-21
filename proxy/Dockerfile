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

# ビルドステージ: 実VPNベンダーCLI（AdGuard VPN CLI）バイナリの取得。
# ソース非公開の配布バイナリのため、公式GitHub Releasesから対象アーキテクチャ向けの
# 静的リンク済みバイナリを取得する（ビルド時のみネットワークアクセスが必要。実行イメージには含めない）。
# Phase 2で実CLIへ置換した（wbs/phase2.md「Step 1: proxy — 実CLI同梱・権限付与」参照）。
FROM alpine:3.20 AS vpn-cli
# 動作確認済みバージョンを固定する。更新時はこの値のみを変更する。
ARG ADGUARDVPN_CLI_VERSION=1.7.12
ARG TARGETARCH
RUN apk add --no-cache curl tar \
  && case "$TARGETARCH" in \
       amd64) CLI_ARCH=x86_64 ;; \
       arm64) CLI_ARCH=aarch64 ;; \
       arm) CLI_ARCH=armv7 ;; \
       *) echo "unsupported TARGETARCH: $TARGETARCH" 1>&2; exit 1 ;; \
     esac \
  && curl -fsSL -o /tmp/adguardvpn-cli.tar.gz \
       "https://github.com/AdguardTeam/AdGuardVPNCLI/releases/download/v${ADGUARDVPN_CLI_VERSION}-release/adguardvpn-cli-${ADGUARDVPN_CLI_VERSION}-linux-${CLI_ARCH}.tar.gz" \
  && mkdir -p /opt/adguardvpn_cli \
  # 配布アーカイブは"adguardvpn-cli-<version>-linux-<arch>/"というトップレベルディレクトリの下に
  # バイナリ等を格納しているため、--strip-components=1でそれを取り除いて展開する。
  && tar -xzf /tmp/adguardvpn-cli.tar.gz -C /opt/adguardvpn_cli --strip-components=1 \
  && chmod +x /opt/adguardvpn_cli/adguardvpn-cli \
  && rm /tmp/adguardvpn-cli.tar.gz

# 実行ステージ
FROM node:22-alpine
# AdGuard VPN CLIは非rootユーザー実行時、TUNインターフェース設定（ip link等）の実行にsudoを要求する
# （cap_add: NET_ADMINを付与していてもCLI内部の実装上sudo経由での昇格が必須）。
# vpngwguiにパスワードなしsudoを付与して対応する。
# nftables: 透過ゲートウェイ・Kill Switchのルール操作用（`iptables`ではなく`nft`を直接使う。
# proxyserver/design.md「NAT/FORWARDルール」参照）。iproute2: `ip route show default`によるVPN
# トンネルインターフェース動的検出用（Alpine標準の busybox ip では出力形式が異なりうるため明示的に導入）。
RUN apk add --no-cache sudo nftables iproute2 \
  && addgroup -g 10001 vpngwgui && adduser -D -u 10001 -G vpngwgui vpngwgui \
  && echo "vpngwgui ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/vpngwgui \
  && chmod 0440 /etc/sudoers.d/vpngwgui
WORKDIR /app
COPY --from=build /repo/proxy/dist ./dist
COPY --from=vpn-cli /opt/adguardvpn_cli/adguardvpn-cli /usr/local/bin/adguardvpn-cli
COPY proxy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /var/run/vpngw-ctl \
  && chown vpngwgui:vpngwgui /var/run/vpngw-ctl \
  # AdGuard VPN CLIはログイン情報を$HOME/.local/share/adguardvpn-cliへ保存する。
  # コンテナ再作成のたびに再ログインが必要にならないよう、named volumeでマウントする前提でディレクトリを用意する
  # （docker-compose.ymlのproxyサービスのvolumes参照）。
  && mkdir -p /home/vpngwgui/.local/share/adguardvpn-cli \
  && chown -R vpngwgui:vpngwgui /home/vpngwgui \
  # 実CLIがログインセッションの妥当性検証に用いる/etc/machine-id・/var/lib/dbus/machine-idを、
  # 起動時にvpngwgui権限で書き換えられるよう、ファイル自体を事前にvpngwgui所有で用意しておく
  # （親ディレクトリの所有権は変更しない。docker-entrypoint.sh参照）。
  && touch /etc/machine-id && chown vpngwgui:vpngwgui /etc/machine-id \
  && mkdir -p /var/lib/dbus && touch /var/lib/dbus/machine-id && chown vpngwgui:vpngwgui /var/lib/dbus/machine-id \
  && chmod +x /usr/local/bin/docker-entrypoint.sh
USER vpngwgui
ENV CTL_SOCKET_PATH=/var/run/vpngw-ctl/exec.sock
ENV HOME=/home/vpngwgui
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
