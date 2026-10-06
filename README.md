# JellyCartoon

Mini-Jellyfin para series propias (DVDs ripeados, dominio público) en red local.
SvelteKit 3 + Bun · Tailwind · Better Auth · Drizzle + Postgres · ffmpeg.

## Cómo funciona

1. **Escanear** (`/library`): recorre `MEDIA_DIR`; cada carpeta de primer nivel es una serie.
   Los episodios se reconocen por `S01E02`, `1x02`, o carpeta `Temporada N` + número en el nombre.
   Sin número → se numeran por orden alfabético. El `[id]` de yt-dlp y el `| Canal` de YouTube se ignoran.
2. **Convertir**: un worker dentro del propio servidor procesa la cola (de uno en uno) y genera
   `DATA_DIR/video/<id>.mp4` (H.264 + AAC, faststart) y `DATA_DIR/thumb/<id>.jpg`.
   - Lo que ya es H.264/AAC se copia sin recodificar.
   - DVD: desentrelaza (`bwdif`) y pasa a píxeles cuadrados.
   - Con varias pistas de audio elige `AUDIO_LANG` (por defecto `spa`).
3. **Reproducir**: `/api/stream/<id>` sirve el MP4 con HTTP Range. El progreso se guarda por usuario.

Los originales nunca se modifican (en Docker se montan en solo lectura).

```
media/
  Dexter's lab/
    Temporada 2/
      Conference [KXyRzBhm4Jw].webm
  Otra serie/
    Otra serie S01E01 - Piloto.mkv
```

## Desarrollo

```sh
cp .env.example .env        # y rellena BETTER_AUTH_SECRET (openssl rand -base64 32)
bun install
bun run db:start            # Postgres en Docker
bun run dev                 # http://localhost:5173 (las migraciones se aplican al arrancar)
```

Al cambiar el esquema: `bun run db:generate` (crea la migración en `drizzle/`).
Necesitas `ffmpeg` y `ffprobe` en el PATH.

## Producción (todo en Docker)

En `.env`: `APP_ORIGIN=http://<ip-del-servidor>:3000`, `HOST_MEDIA_DIR` (tus vídeos) y
`HOST_DATA_DIR` (dónde guardar los convertidos), y luego:

```sh
docker compose --profile app up -d --build
```

Cuando hayas creado tu cuenta, pon `ALLOW_SIGNUP=false`.

## Pendiente

- Control remoto (dispositivos + comandos play/pause/seek por SSE).
- Subtítulos (los de DVD son imágenes: quemar u OCR).
- Metadatos/pósters (TMDB) y edición manual de títulos.
