# ビルドステージ: OpenAPI仕様の生成にapiのビルド成果物が必要なため、apiのソースも取り込む。
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY web/package.json web/package.json
COPY api/package.json api/package.json
COPY proxy/package.json proxy/package.json
RUN npm ci
COPY tsconfig.base.json tsconfig.base.json
COPY api api
COPY web web
RUN npm run build -w api \
  && npm run export-openapi -w api \
  && npm run generate:api-client -w web \
  && npm run build -w web \
  && npm run build:server -w web
RUN npm prune --omit=dev

# 実行ステージ
FROM node:22-alpine
RUN addgroup -g 10001 vpngwgui && adduser -D -u 10001 -G vpngwgui vpngwgui
WORKDIR /app
COPY --from=build /repo/web/dist ./dist
COPY --from=build /repo/web/dist-server ./dist-server
COPY --from=build /repo/node_modules ./node_modules
USER vpngwgui
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist-server/index.js"]
