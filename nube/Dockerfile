# The cloud's app (#253), built from this folder (nube/ as the build context): in Dokploy, its
# «Build Path» is /nube.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# Only so that the build finds them; the real ones come at runtime.
RUN DATABASE_URL=postgres://build/build ORIGIN=http://localhost BETTER_AUTH_SECRET=build bun run build

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/lib/server/db ./src/lib/server/db
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=1m --retries=3 \
	CMD ["bun", "-e", "fetch('http://localhost:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# The migrations as the owner (MIGRATE_DATABASE_URL), then the app as its role (DATABASE_URL).
CMD ["sh", "-c", "bun scripts/migrate.ts && exec bun build/index.js"]
