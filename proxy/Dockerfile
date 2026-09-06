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

# 実行ステージ
FROM node:22-alpine
RUN addgroup -g 10001 vpngwgui && adduser -D -u 10001 -G vpngwgui vpngwgui
WORKDIR /app
COPY --from=build /repo/proxy/dist ./dist
COPY --from=build /repo/proxy/mock-cli/adguardvpn-cli-mock.mjs /usr/local/bin/adguardvpn-cli-mock
RUN chmod +x /usr/local/bin/adguardvpn-cli-mock \
  && mkdir -p /var/run/vpngw-ctl \
  && chown vpngwgui:vpngwgui /var/run/vpngw-ctl
USER vpngwgui
ENV CTL_SOCKET_PATH=/var/run/vpngw-ctl/exec.sock
CMD ["node", "dist/server.js"]
