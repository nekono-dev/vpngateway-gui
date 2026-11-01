# AdGuard VPN 用ランナー（runner-adguardvpn）のモック版。E2E（hosted）専用で、本番のイメージ（vendors/adguardvpn/Dockerfile）の代わりに使う（e2e-tests 1.10）。
# 本番のランナー本体（dist/runner.js）と同じ受け口を持ち、公式 CLI の代わりに mock-cli（mockvpn.mjs）を /usr/local/bin/adguardvpn-cli に置く。
# 公式 CLI の依存（D-Bus・NetworkManager・keyring）は持たない。経路の操作（vpn0・既定経路）は、コンテナ内の ip で行う。

# ビルドステージ: ランナー本体と、モック CLI（1 ファイルに束ねる）。
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
COPY api/package.json api/package.json
COPY proxy/package.json proxy/package.json
RUN npm ci --no-audit --no-fund
COPY proxy proxy
COPY tsconfig.base.json tsconfig.base.json
RUN npm run build -w proxy
COPY e2e/hosted/vendors/mock-cli e2e/hosted/vendors/mock-cli
RUN ./node_modules/.bin/esbuild e2e/hosted/vendors/mock-cli/main.ts --bundle --platform=node --format=esm --target=node22 --outfile=/out/mockvpn.mjs

# 実行ステージ
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends iproute2 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /repo/proxy/dist ./dist
COPY --from=build /out/mockvpn.mjs /opt/mock/mockvpn.mjs
COPY vendors /opt/mock/vendors
# 許可されたバイナリのパス（RUNNER_ALLOWED_BINARY）に、モック CLI の呼び出し名を置く
RUN printf '#!/bin/sh\nexec node /opt/mock/mockvpn.mjs adguardvpn-cli "$@"\n' > /usr/local/bin/adguardvpn-cli && chmod 755 /usr/local/bin/adguardvpn-cli
ENV RUNNER_ALLOWED_BINARY=/usr/local/bin/adguardvpn-cli
ENV MOCKVPN_SAMPLES_DIR=/opt/mock/vendors
ENV MOCKVPN_STATE_DIR=/var/lib/mockvpn
ENV CTL_SOCKET_PATH=/var/run/vpngw-ctl/runner-adguardvpn.sock
RUN mkdir -p /var/run/vpngw-ctl /var/lib/mockvpn
CMD ["node", "dist/runner.js"]
