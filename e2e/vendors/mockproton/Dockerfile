# モックプロバイダ用ランナー（`runner-mockproton`）のイメージ。**E2E専用**（`e2e/vendors/mockproton/`のバンドル）。
# ベンダーCLIを含まず、モックCLI（e2e/vendors/mockproton/protonvpn-mock.mjs）をcomposeでマウントして使う。
# 許可バイナリ（RUNNER_ALLOWED_BINARY）・ソケット名もcomposeで与える（実運用のランナーとは別のサービス・イメージ）。

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

FROM node:22-alpine
RUN addgroup -g 10001 vpngwgui && adduser -D -u 10001 -G vpngwgui vpngwgui
WORKDIR /app
COPY --from=build /repo/proxy/dist ./dist
RUN mkdir -p /var/run/vpngw-ctl && chown vpngwgui:vpngwgui /var/run/vpngw-ctl
USER vpngwgui
ENV HOME=/home/vpngwgui
CMD ["node", "dist/runner.js"]
