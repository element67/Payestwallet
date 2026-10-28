# Payest Wallet API. Build context is the repository root.
FROM oven/bun:1.3.14-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server ./server
COPY shared ./shared
COPY tsconfig.json ./
USER bun
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/api/health" || exit 1
CMD ["bun", "run", "server/index.ts"]
