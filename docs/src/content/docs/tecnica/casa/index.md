---
title: 'JellyCartoon, la casa'
description: 'Qué es y cómo funciona por dentro: escanear, convertir, programación y reproducción.'
---

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
4. **Reproducir**: hls.js (Safari usa su HLS nativo), con los controles de
   [Media Chrome](https://www.media-chrome.org) en los colores de la app, iguales en todos los
   navegadores y en español. En su menú ⚙ se elige audio y subtítulos (y su estilo), «Al terminar»,
   el tamaño y «Usar este fotograma como miniatura»; la elección se guarda por usuario y se aplica
   a los siguientes episodios. El progreso también. Los adultos tienen también «Usar este fotograma
   de fondo de la serie».
   **Fondo**: arriba en la página de cada serie y película (también en la vista de tele) sale un
   fotograma suyo, nítido arriba y cada vez más difuminado y oscuro hacia abajo. Lo elige la app: de
   unos cuantos del medio del primer capítulo (o de la película), el de más color que no sea oscuro
   ni quemado, sin las bandas negras. Se cambia desde el reproductor o, en las películas, desde la
   vista de pájaro («Usar de fondo»); «volver al automático», arriba en su página. Se guardan en
   `DATA_DIR/fondo`.
   «⚙ Estilo» cambia cómo se ven los subtítulos (fuente, tamaño, color, fondo, contorno) y dónde:
   abajo, algo más arriba o más arriba, para que los ojos viajen menos; vale también para los
   canales y para el mpv del salón (`sub-pos`). Y, en los automáticos de Whisper, cómo se ven dos
   frases seguidas: «Una línea» (cada frase sola, para el diálogo pausado), «Dos líneas fijas» (la segunda aparece debajo y no se mueve nada), «Suben»
   (la anterior sube y la nueva entra abajo) o «Suben, la de arriba en gris». Cada uno se monta
   al pedirlo a partir de las frases (`sub_auto_<idioma>.json`); para mpv, un fichero de cada
   forma junto al de siempre (la gris, en `.srt`, cuyo color mpv sí respeta).
   «Al terminar: Siguiente / Parar» (también guardado por usuario) decide si al acabar un
   capítulo empieza el siguiente de la serie, o de la programación o la lista. Con «Parar» el
   capítulo se marca como visto igual; en la programación y las listas el siguiente queda cargado
   y en pausa.

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
