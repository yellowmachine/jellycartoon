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
bun run dev                 # aplica migraciones y arranca en http://localhost:5173
```

Al cambiar el esquema: `bun run db:generate` crea la migración en `drizzle/` y `bun run db:migrate`
la aplica (también lo hacen `bun run dev` y el contenedor antes de arrancar la app). Tests: `bun run test`.
Necesitas `ffmpeg` y `ffprobe` en el PATH.

## Producción (todo en Docker)

En `.env`: `APP_ORIGIN=http://<ip-del-servidor>:3000`, `HOST_MEDIA_DIR` (tus vídeos) y
`HOST_DATA_DIR` (dónde guardar los convertidos), y luego:

```sh
docker compose --profile app up -d --build
```

`APP_ORIGIN` se fija al construir la imagen (SvelteKit lo usa para la protección CSRF de los
formularios): si lo cambias, vuelve a lanzar el comando con `--build`. Entra siempre por esa URL.

Cuando hayas creado tu cuenta, pon `ALLOW_SIGNUP=false`. La fecha de "hoy" usa `TZ` (por defecto `Europe/Madrid`).

## Pendiente

- Control remoto (dispositivos + comandos play/pause/seek por SSE).
- Subtítulos de imagen (VobSub/PGS): OCR.
- Telecine inverso para DVD de dibujos rodados en película.
- Metadatos/pósters (TMDB) y edición manual de títulos.
