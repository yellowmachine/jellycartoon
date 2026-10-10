# JellyCartoon

Mini-Jellyfin para series propias (DVDs ripeados, dominio público) en red local.
SvelteKit 3 + Bun · Tailwind · Better Auth · Drizzle + Postgres · ffmpeg.

## Cómo funciona

1. **Escanear** (`/library`): recorre `MEDIA_DIR`; cada carpeta de primer nivel es una serie.
   Los episodios se reconocen por `S01E02`, `1x02`, o carpeta `Temporada N` + número en el nombre.
   Sin número → se numeran por orden alfabético. El `[id]` de yt-dlp y el `| Canal` de YouTube se ignoran.
2. **Convertir**: un worker dentro del propio servidor procesa la cola (de uno en uno) y genera
   HLS en `DATA_DIR/hls/<id>/` (H.264 + una pista AAC por idioma, segmentos fMP4) y
   `DATA_DIR/thumb/<id>.jpg`. Se hace una sola vez, no al reproducir.
   - Lo que ya es H.264/AAC se copia sin recodificar.
   - DVD: desentrelaza (`bwdif`) y pasa a píxeles cuadrados.
   - Se conservan **todas** las pistas de audio; `AUDIO_LANG` (por defecto `spa`) es la de por defecto.
   - Subtítulos a WebVTT: los de texto que trae el fichero (SRT/ASS) y los externos con el mismo
     nombre que el vídeo (`Episodio.en.vtt`, `Episodio.es-419.srt`). Los de imagen del DVD (VobSub)
     aún no.
3. **Programación de hoy** (`/today`): playlist diaria por usuario de 30/60/90 min. Las series
   "con continuidad" aportan su siguiente episodio pendiente; las de "episodios sueltos" (se cambia
   en la ficha de la serie) aportan uno al azar, priorizando lo no visto. Nunca dos seguidos de la
   misma serie. Lo visto se apunta al dueño de la playlist (pensando en el envío a otro dispositivo).
4. **Reproducir**: hls.js (Safari usa su HLS nativo). Bajo el vídeo se elige audio y subtítulos;
   la elección se guarda por usuario y se aplica a los siguientes episodios. El progreso también.

YouTube con subtítulos, en el formato que espera el escáner:

```sh
yt-dlp -f "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[ext=mp4]" --merge-output-format mp4 \
  --write-subs --sub-langs "en.*,es.*" --convert-subs vtt \
  -o "media/Serie/Temporada 1/S01E%(playlist_index)02d - %(title)s.%(ext)s" URL
```

Los originales nunca se modifican (en Docker se montan en solo lectura).

```
media/
  Superman (1941)/
    Temporada 1/
      S01E01 - The Mad Scientist.mp4
  Otra serie/
    Otra serie S01E01 - Piloto.mkv
```

## Desarrollo

```sh
cp .env.example .env        # y rellena BETTER_AUTH_SECRET (openssl rand -base64 32)
bun install
bun run db:start            # Postgres en Docker
bun run dev                 # aplica migraciones y arranca en http://localhost:5173
```

Al cambiar el esquema: `bun run db:generate` crea la migración en `drizzle/` y `bun run db:migrate`
la aplica (también lo hacen `bun run dev` y el contenedor antes de arrancar la app). Tests: `bun run test`.
Necesitas `ffmpeg` y `ffprobe` en el PATH.

## Producción

Usa la imagen que construye GitHub Actions en cada push a `main`
(`ghcr.io/yellowmachine/jellycartoon`, etiquetas `latest` y `sha-<commit>`). En el servidor solo
hacen falta `compose.prod.yaml` y un `.env` con:

```sh
ORIGIN="http://<ip-del-servidor>:3000"   # URL desde la que se abre la app
BETTER_AUTH_SECRET="..."                 # openssl rand -base64 32
HOST_MEDIA_DIR="/ruta/a/los/videos"
HOST_DATA_DIR="/ruta/a/los/convertidos"
```

```sh
docker compose -f compose.prod.yaml pull     # descarga la última imagen
docker compose -f compose.prod.yaml up -d    # arranca o actualiza
docker compose -f compose.prod.yaml logs -f app
```

- `ORIGIN` se lee al arrancar: la misma imagen sirve en cualquier dirección. Si cambia, edita el
  `.env` y `docker compose -f compose.prod.yaml up -d`.
- Delante de la app va Caddy (`caddy reverse-proxy`), que es quien expone el puerto 3000. Le pasa
  a la app el protocolo real en `X-Forwarded-Proto` (`PROTOCOL_HEADER`, como indica la
  [documentación de adapter-node](https://svelte.dev/docs/kit/adapter-node)); sin eso SvelteKit
  supone https y rechaza los formularios enviados por http.
- Si `HOST_DATA_DIR` es una ruta absoluta, cada capítulo convertido tiene un botón ⧉ que copia
  la ruta de su `master.m3u8` para abrirlo en el mismo PC con mpv u otro reproductor
  (`mpv <ruta>`). Por http desde otra IP el navegador no deja copiar: muestra la ruta seleccionada.
- La app corre como `PUID:PGID` (por defecto `1000:1000`), que es el dueño de `HOST_DATA_DIR`.
- Para fijar una versión concreta: `IMAGE_TAG=sha-abc1234` en el `.env`.
- `DELETE_SOURCES=true` borra de `HOST_MEDIA_DIR` cada original (y sus subtítulos externos) en
  cuanto se convierte; el episodio sigue en el catálogo. Útil si guardas copia en otro disco.
  Los ficheros modificados hace menos de un minuto se ignoran al escanear (copias en curso).
  En Biblioteca aparece un botón para borrar los que ya estaban convertidos. Ojo: para
  reconvertir (cambios de formato o de calidad) habrá que volver a copiar los originales.
- Cuando estén creadas las cuentas, pon `ALLOW_SIGNUP=false`. "Hoy" usa `TZ` (por defecto
  `Europe/Madrid`).
- `compose.yaml` es solo para desarrollo (Postgres con el puerto abierto). Ambos ficheros
  comparten la base de datos; usa uno u otro, no los dos a la vez.

### Cine

Una carpeta aparte de películas (mkv grandes) que solo se catalogan: nunca se convierten ni se
borran. Con `HOST_CINEMA_DIR="/ruta/a/las/peliculas"` en el `.env` se monta de solo lectura y
aparece la sección Cine; sin ella, no. En desarrollo se usa `CINEMA_DIR` con la ruta.

- «Escanear carpeta» busca vídeos en la carpeta y sus subcarpetas. Una subcarpeta con un único
  vídeo se cataloga con el nombre de la carpeta. Las copias de disco (`BDMV`, `VIDEO_TS`) se
  saltan y se avisa en el Registro.
- El título sale del nombre del fichero, quitando lo que añade MakeMKV (`_t00`, ` T01`,
  `Disc 1`); un año entre paréntesis al final, `Título (1964)`, se guarda aparte. Se puede editar.
- En segundo plano, de una en una, se saca la duración, las pistas de audio y subtítulos y una
  miniatura (con tone mapping si la película es HDR).

## Copia de seguridad

Qué hay que guardar:

- **Base de datos**: usuarios, progreso, listas, títulos y numeración cambiados a mano. Se copia
  con [`pg_dump`](https://www.postgresql.org/docs/current/app-pgdump.html), no copiando el
  volumen.
- **`HOST_DATA_DIR`**: los vídeos convertidos y las miniaturas. Va con la base de datos (cada
  episodio es `hls/<id>`). Con `DELETE_SOURCES=true` es la única copia de los vídeos.
- **`.env`**: la configuración y `BETTER_AUTH_SECRET`. Guárdalo en un sitio seguro.
- **`HOST_MEDIA_DIR`**, opcional: los originales. Con ellos se puede regenerar `HOST_DATA_DIR`,
  pero son horas de conversión.

`scripts/backup.sh` lo hace todo, con la app en marcha. Ejecútalo desde la carpeta de
`compose.prod.yaml` y `.env` (necesita `jq` y `rsync`):

```sh
scripts/backup.sh /ruta/del/backup            # base de datos, convertidos y .env
scripts/backup.sh --media /ruta/del/backup    # además, los originales
```

Deja `jellycartoon.dump`, `data/`, `.env` y, con `--media`, `media/`. Las carpetas son un espejo:
cada copia sustituye a la anterior en el mismo destino. Primero hace el volcado y luego copia
los ficheros; un episodio que termine de convertirse entre medias se volvería a convertir al
restaurar, pero nunca queda uno listo sin sus ficheros.

Para restaurar, con el `.env` de la copia en su sitio y las carpetas de `HOST_DATA_DIR` (y
`HOST_MEDIA_DIR`) vueltas a copiar:

```sh
docker compose -f compose.prod.yaml up -d db
docker compose -f compose.prod.yaml exec -T db \
  pg_restore -U jellycartoon -d jellycartoon --clean --if-exists --no-owner < /ruta/del/backup/jellycartoon.dump
docker compose -f compose.prod.yaml up -d
```

La app aplica al arrancar las migraciones posteriores a la copia.

## Pendiente

- Control remoto (dispositivos + comandos play/pause/seek por SSE).
- Subtítulos de imagen (VobSub/PGS): OCR.
- Telecine inverso para DVD de dibujos rodados en película.
- Metadatos/pósters (TMDB) y edición manual de títulos.
