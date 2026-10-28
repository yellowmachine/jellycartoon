# The cloud's app (#253), built from the repository's root (compose.prod.yaml: context `..`), as
# it uses the shared package (packages/comun) through Bun's workspaces. Only what it needs goes in
# (Dockerfile.dockerignore beside this file).
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/comun/package.json packages/comun/
COPY nube/package.json nube/
RUN bun install --frozen-lockfile --filter nube
COPY packages/comun packages/comun
COPY nube nube
WORKDIR /app/nube
# Only so that the build finds them; the real ones come at runtime.
RUN DATABASE_URL=postgres://build/build ORIGIN=http://localhost BETTER_AUTH_SECRET=build bun run build

FROM oven/bun:1-slim
WORKDIR /app/nube
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/nube/node_modules ./node_modules
COPY --from=build /app/nube/build ./build
COPY --from=build /app/nube/drizzle ./drizzle
COPY --from=build /app/nube/scripts ./scripts
COPY --from=build /app/nube/src/lib/server/db ./src/lib/server/db
COPY --from=build /app/nube/package.json ./
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=1m --retries=3 \
	CMD ["bun", "-e", "fetch('http://localhost:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# The migrations as the owner (MIGRATE_DATABASE_URL), then the app as its role (DATABASE_URL).
CMD ["sh", "-c", "bun scripts/migrate.ts && exec bun build/index.js"]
