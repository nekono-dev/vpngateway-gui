# ビルドステージ: npm workspacesの依存解決のためリポジトリルートをbuild contextとする
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY web/package.json web/package.json
COPY api/package.json api/package.json
COPY proxy/package.json proxy/package.json
RUN npm ci
COPY tsconfig.base.json tsconfig.base.json
COPY api api
RUN npm run build -w api
RUN npm prune --omit=dev

# 実行ステージ
FROM node:22-alpine
RUN addgroup -g 10001 vpngwgui && adduser -D -u 10001 -G vpngwgui vpngwgui
WORKDIR /app
COPY --from=build /repo/api/dist ./dist
COPY --from=build /repo/node_modules ./node_modules
RUN mkdir -p /var/lib/vpngwgui && chown vpngwgui:vpngwgui /var/lib/vpngwgui
USER vpngwgui
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/server.js"]
