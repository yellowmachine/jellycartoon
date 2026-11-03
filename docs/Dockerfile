# The documentation (#380): Starlight built with Bun, then only the static site, served by Caddy
# on port 80 (Dokploy's Traefik in front, with the certificate). Context: this folder.
FROM oven/bun:1 AS build
WORKDIR /docs
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM caddy:2.11
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /docs/dist /srv
