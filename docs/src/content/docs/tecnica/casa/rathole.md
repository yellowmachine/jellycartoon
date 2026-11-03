---
title: 'Las APIs desde fuera, con rathole'
---

Para que otras apps lleguen desde fuera (la música por Subsonic, p. ej.
[Tempus](https://github.com/eddyizm/tempus)), un túnel [rathole](https://github.com/rapiz1/rathole)
con un VPS (#253). El túnel es de cada casa, en el VPS que quiera: Seilide no da uno, solo usa la
dirección que cada familia le da. La casa abre una conexión saliente al VPS, y lo que llega al VPS por un segundo
nombre (`MEDIA_HOST`, p. ej. `media.<tu-dominio>`) se manda por ella al Caddy de casa **sin
descifrar**: el certificado es el de casa y el VPS solo lo pasa. Por ese nombre solo se sirve
`/rest` (Subsonic); el resto de la app da 404 y sigue siendo solo de casa.

1. En el VPS, el servidor de rathole (`rathole --genkey` para el par de claves, transporte
   `noise`, un servicio `jellycartoon` con su token) y algo que pase el 443 de `MEDIA_HOST` a ese
   servicio sin descifrarlo (en Traefik, un router TCP con `HostSNI` y `tls.passthrough`).
2. En Cloudflare, un registro `A` de `MEDIA_HOST` → IP pública del VPS, en modo **DNS only**.
3. En el `.env` de casa:
   ```sh
   COMPOSE_PROFILES="snapcast,tunel"     # además de los que ya hubiera
   MEDIA_HOST="media.tu-dominio.com"     # sin https://
   RATHOLE_REMOTE="IP-del-VPS:2333"
   RATHOLE_SERVER_PUBLIC_KEY="…"         # la pública del servidor
   RATHOLE_TOKEN="…"
   ```
   y `docker compose -f compose.prod.yaml up -d`. Caddy pide el certificado de `MEDIA_HOST` con
   el mismo reto DNS-01.

## La API de vídeo, para Seilide

Las series (no el cine, que es solo de casa), para la app de Seilide (#253), en `/api/v1` por
`MEDIA_HOST`. De momento solo para adultos.

- **La clave:** Ajustes → Casa → «Seilide» → «Nueva clave». Se guarda en el servidor de Seilide,
  nunca en el navegador. Cada petición lleva `x-api-key: <clave>` y `x-persona: <email>`, el de
  la persona en cuyo nombre se pide (un adulto de la casa; si no, 403).
- `GET /api/v1/series`: las series con algo que ver.
- `GET /api/v1/series/<id>`: sus capítulos listos, con por dónde va esa persona.
- `POST /api/v1/episodios/<id>/ver` (JSON; `{"calidad": "original"}` para la original): un
  enlace firmado a su HLS, en 720p si lo tiene, que vale 12 horas solo para esa persona y ese
  capítulo, y otro para su progreso. El navegador los abre directamente, sin clave ni cookie
  (con CORS abierto: el enlace es el permiso).
- `POST <progressUrl>` con `{"positionSec": …, "durationSec": …}` (JSON): se guarda como en la app
  y sale en «Seguir viendo».

**La música**, con la misma clave y `x-persona` (#253, para el modo carretera de Seilide):

- `GET /api/v1/musica/albumes`: los álbumes, sin sus canciones; `GET /api/v1/musica/albumes/<id>`,
  uno con sus canciones.
- `GET /api/v1/musica/listas` y `GET /api/v1/musica/listas/<id>`: las listas de la casa.
- `GET /api/v1/musica/aleatorio`: «Todo aleatorio», 200 canciones de toda la música, mezcladas.
- `POST /api/v1/musica/pase` (JSON): un pase de 12 horas para esa persona, `base`, con el que el
  navegador abre directamente las canciones (`<base>/pistas/<id>`, su copia en Opus, #64) y las
  portadas (`<base>/portadas/<id del álbum>`). Uno para toda la música: es de toda la casa.

Para probarla sin Seilide, `scripts/prueba-video.ts` hace de Seilide: guarda la clave y sirve una
página que lista las series y reproduce los capítulos:

```sh
MEDIA_URL=https://media.tu-dominio.com MEDIA_KEY=casita_… PERSONA=tu@email bun scripts/prueba-video.ts
```

y se abre `http://<IP de este PC>:8787` en el móvil.
