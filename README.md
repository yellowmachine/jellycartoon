# JellyCartoon

Mini-Jellyfin para series propias (DVDs ripeados, dominio público) en red local: series,
películas, música, radio y juegos en un ordenador de casa, para la tele, el móvil, la tablet y el
coche. SvelteKit 3 + Bun · Tailwind · Better Auth · Drizzle + Postgres · ffmpeg.

En un PC con Linux y Docker (o una Raspberry de 64 bits, sin vídeo):

```sh
curl -fsSL https://raw.githubusercontent.com/yellowmachine/jellycartoon/main/install.sh | sh
```

**Documentación: https://docs.seilide.app** (fuente en [`docs/`](docs/), con
[Starlight](https://starlight.astro.build)): cómo funciona, instalar y configurar la casa,
[Seilide](nube/) (la nube) y el [satélite de voz](satellite/). Para verla mientras se escribe:
`cd docs && bun install && bun run dev`.

## Desarrollo

```sh
cp .env.example .env        # y rellena BETTER_AUTH_SECRET (openssl rand -base64 32)
bun install
bun run db:start            # Postgres en Docker
bun run dev                 # aplica migraciones y arranca en http://localhost:5173
```

Más en [Desarrollo](https://docs.seilide.app/tecnica/casa/desarrollo/).

## Licencia

[AGPL-3.0-or-later](LICENSE), para todo el repositorio: la casa, `nube/` (Seilide), `packages/` y
`satellite/`. Se puede usar, cambiar y compartir, también con fines comerciales; quien ofrezca una
versión modificada a otros, también por la red (un Seilide propio), tiene que publicar su código.
