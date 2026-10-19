# The trips relay (#81), for a VPS (Dokploy): PUBLISH_KEY in its environment, PORT 3000.
FROM oven/bun:1-slim
WORKDIR /relay
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server.ts store.ts ./
COPY public ./public
USER bun
EXPOSE 3000
CMD ["bun", "server.ts"]
