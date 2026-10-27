FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# Real values are injected at runtime; the build only needs them to be present.
RUN DATABASE_URL=postgres://build/build ORIGIN=http://localhost BETTER_AUTH_SECRET=build bun run build

FROM oven/bun:1-slim
# mpv and snapserver are only for the optional Snapcast services of compose.prod.yaml, which run
# this same image with another command. poppler-utils: a bill's PDF read by its text (#232).
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ffmpeg mpv snapserver poppler-utils \
	&& rm -rf /var/lib/apt/lists/*
# go-pmtiles, to cut a route's map out of Spain's (#164): the binary of its official image, the
# same version as scripts/mapa.sh.
COPY --from=protomaps/go-pmtiles:v1.31.2 /go-pmtiles /usr/local/bin/pmtiles
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
# For the snapserver service, which runs this image: inside it, so that it is still there when WUD
# recreates the container (#20).
COPY deploy/snapserver.conf /etc/jellycartoon/snapserver.conf
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production PORT=3000
# Bodies up to 10 MB (adapter-node's default is 512 KB): a road mode's photo can be more (#81). In the
# image, not in each house's compose.
ENV BODY_SIZE_LIMIT=10M
# Stopping: adapter-node waits this long for open connections (the TVs' and phones' live state,
# SSE, never end by themselves) before closing them. Docker kills the container after 10 s, and
# a container killed while Docker itself stops may not come back up (#228).
ENV SHUTDOWN_TIMEOUT=3
# The release (`1.2.0`) or the commit (`sha-…`): GitHub Actions passes it (#20).
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
EXPOSE 3000
# WUD keeps an update only once the new container is healthy, and goes back otherwise (#20). Long
# enough at first for the migrations. The Snapcast services run this image with another command and
# turn it off in compose.prod.yaml.
HEALTHCHECK --interval=30s --timeout=5s --start-period=2m --retries=3 \
	CMD ["bun", "-e", "fetch('http://localhost:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Migrate first; the app only starts if that succeeds.
CMD ["sh", "-c", "bun scripts/migrate.ts && exec bun build/index.js"]
