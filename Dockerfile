FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# Real values are injected at runtime; the build only needs them to be present.
RUN DATABASE_URL=postgres://build/build ORIGIN=http://localhost BETTER_AUTH_SECRET=build bun run build

FROM oven/bun:1-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["bun", "build/index.js"]
