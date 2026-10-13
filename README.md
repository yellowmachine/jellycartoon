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
- «Borrar capítulo…» (en el menú de cada uno, o varios con «Seleccionar capítulos») los borra para
  siempre, original de `HOST_MEDIA_DIR` incluido, para que el escaneo no los vuelva a traer: útil
  para la basura que viene con lo bajado de YouTube. Lo que la IA marca como «no es un episodio» va
  a la temporada 0, y ahí se selecciona entera.
- Cuando estén creadas las cuentas, pon `ALLOW_SIGNUP=false`. "Hoy" usa `TZ` (por defecto
  `Europe/Madrid`).
- `compose.yaml` es solo para desarrollo (Postgres con el puerto abierto). Ambos ficheros
  comparten la base de datos; usa uno u otro, no los dos a la vez.

### Ficha de cada serie

La primera vez que se abre una serie se busca en [Wikidata](https://www.wikidata.org) (años,
temporadas, número de episodios) y Wikipedia (resumen), como las películas: si no está claro
pregunta «¿Cuál de estas series es?», y siempre se puede buscar a mano por otro título. Con la clave
de OpenRouter, la IA identifica antes la serie a partir de la carpeta y de algunos nombres de
fichero. La ficha guarda también dónde están listados sus episodios: el anexo de episodios de
Wikipedia en español y en inglés si lo hay, o si no el artículo de la serie.

Con la ficha y la clave, «Poner títulos y numeración con la IA» manda al modelo de escenas y títulos esas páginas de episodios y los ficheros en el orden de sus nombres, en lotes de 25:
cada uno con su ruta, su duración y tres fotogramas (a los 8 y 20 segundos, donde los dibujos
clásicos enseñan el cartel con el título, y la miniatura). Sirve sobre todo para las copias de disco
(`Disc 2_t06.mkv`) y lo bajado de YouTube sin número. La IA propone para cada fichero temporada,
número y título, o dice que no es un episodio (openings, extras, otra cosa). Nada cambia hasta que
lo revisas: se aplica lo que marques, y el resto se descarta.

- «Parar» corta la tanda, también la petición en curso; lo que ya propusieron los lotes terminados
  queda para revisarlo.
- Si se añaden capítulos después (otra temporada), solo se le mandan los que no tienen título de
  la IA; los demás van como texto, para que siga la numeración. «Rehacer todos» los manda todos.
- El título de la IA va aparte: el que pongas a mano sigue mandando, y si lo borras vuelve el de la
  IA.
- La temporada y el número aplicados ya no los cambia el escaneo, como al organizar temporadas. Lo
  que no es un episodio va al final de la temporada 0.
- La lista de episodios va entera en cada lote: cada uno son unos céntimos y menos de un minuto, y
  una serie de cientos de episodios (Shin Chan) puede costar un par de euros.
- Un fichero con varios episodios seguidos se queda en uno, con los títulos unidos por « / ».

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

#### Ficha de cada película

Al pulsar una película se abre su ficha. La primera vez se busca en
[Wikidata](https://www.wikidata.org) (director, reparto, año, género, país, enlace a IMDb) y
Wikipedia en español o, si no hay artículo, en inglés (sinopsis); queda guardada en la base de
datos. Las dos son gratuitas y sin clave.

- No hace falta abrirlas: después de cada escaneo se buscan en segundo plano, de una en una, las
  fichas de las películas catalogadas que no la tengan, nuevas o no. Las que queden por confirmar llevan «Elegir ficha» en la
  cuadrícula.
- El buscador de Cine busca por título (también el original), director y actor. En la ficha, cada
  persona, género y país lleva a Cine filtrado por ella.
- Para acertar se usa el título, el año del nombre del fichero y la duración. Si no está claro
  pregunta «¿Cuál de estas es?», y siempre se puede buscar a mano por otro título.
- Con una clave de OpenRouter (en Ajustes, o `OPENROUTER_API_KEY` en el `.env`), una IA identifica primero la película a partir del
  nombre del fichero (erratas, títulos españoles, restos de MakeMKV): da el título original, el año
  y el director, y con eso se busca en Wikidata. Los datos de la ficha nunca los inventa la IA;
  solo escribe la sinopsis si no hay artículo en Wikipedia, y lo indica.
- Cada petición a la IA (identificar, sinopsis, escenas, títulos de episodios, conversaciones)
  deja una línea en el Registro con la fuente `ia`: para qué era, los tokens y lo que costó según
  OpenRouter.

#### Escenas

Casi todas las películas copiadas de un disco traen sus capítulos, puestos por el estudio en los
cambios de escena. Se leen al catalogar (las ya catalogadas, después del siguiente escaneo o
arranque) y la ficha los muestra como «Escenas»: un fotograma de cada una y «Ver desde aquí en el
salón», que empieza justo al principio de la escena.

Los discos los llaman «Chapter 01, 02…». Con la clave de OpenRouter, «Ponerles nombre con la IA»
manda un fotograma de cada escena y los artículos de Wikipedia al modelo de escenas y títulos (en Ajustes), que
les pone un nombre corto («Pongo y Perdita se conocen en el parque»). Tarda un minuto o dos, se
hace una vez por película y cuesta unos céntimos. Como cuentan el argumento, los nombres solo se
ven sin pedirlo si ya has visto la película.

#### Vista de pájaro

En la ficha, «Ver» muestra la película de un vistazo en 10, 20 o 30 fotogramas (a elegir en el
desplegable) repartidos de principio a fin, saltando logos y créditos. Cada uno cae en un momento al
azar de su tramo de la película, pero el azar sale del id de la película, así que siempre se ven los
mismos. Se sacan del fichero al pedirlos, de tres en tres, y no
se guardan en el servidor (el navegador los recuerda un día). Al pulsar uno se ve en grande, se pasa
al anterior o al siguiente, y «Ver desde aquí en el salón» la empieza en ese momento.

#### Preguntarle a la IA

Con la clave de OpenRouter, al final de cada ficha hay una conversación: «¿cómo se hizo?»,
«háblame de su estilo visual»… Desde el móvil se puede dictar con el micrófono del teclado.

- Cada pregunta lleva la ficha y los artículos completos de Wikipedia en español e inglés, y la IA
  se basa en ellos; si añade algo que no viene de ahí, lo dice. Sabe si ya la has visto (o por
  dónde vas) para no desvelarte el final.
- Las respuestas van apareciendo mientras se escriben y la conversación queda guardada por usuario
  y película. «Parar» corta la respuesta y guarda lo que llevaba; cerrar la página no la corta.
- En Ajustes se elige un modelo aparte para conversar (por defecto uno mejor que el de identificar:
  unos céntimos por pregunta) y si puede [buscar en la web](https://openrouter.ai/docs/guides/features/plugins/web-search),
  que añade enlaces a las fuentes y cuesta algo más.

#### Ver en el salón

Las películas y los capítulos se ven con mpv en la pantalla del PC donde corre la app. Allí queda un mpv
esperando, sin ventana, como servicio de usuario de systemd; la app le manda la película por su
socket ([JSON IPC](https://mpv.io/manual/stable/#json-ipc)) y guarda por dónde vas cada 5
segundos. Hace falta una sesión gráfica iniciada (Wayland o X11) y mpv instalado. Para instalarlo,
desde el repositorio y con la ruta de `HOST_DATA_DIR`:

```sh
mkdir -p ~/.config/systemd/user
sed 's|@SOCKET@|/ruta/a/los/convertidos/mpv.sock|' deploy/jellycartoon-mpv.service \
  > ~/.config/systemd/user/jellycartoon-mpv.service
systemctl --user daemon-reload
systemctl --user enable --now jellycartoon-mpv
```

- El socket va en `HOST_DATA_DIR`, que ya está montado en el contenedor (`/data/mpv.sock`) y es
  del mismo usuario (`PUID`), así que no hace falta montar nada más.
- En el menú ⋯ de cada película: «Ver en el salón», o «Continuar desde…» y «Empezar desde el
  principio» si ya la empezaste. Se usan tus idiomas de audio y subtítulos. Al pasar del 92 % o
  llegar al final queda como vista.
- Con el ratón o el teclado se controla mpv como siempre; `q` lo cierra y el servicio lo deja
  esperando otra vez.
- Capítulos: «Ver en el salón» en el menú ⋯ de cada capítulo convertido manda ese y, con
  «siguiente automático», los siguientes de la serie. En Hoy y en las listas, «Ver lo que queda
  en el salón» manda los que faltan por ver, y ▶︎ en cada uno empieza desde él. Van todos a la
  lista de reproducción de mpv, que pasa solo al siguiente; cada uno empieza por donde se dejó y
  al verlo se tacha en Hoy y en tus listas. Hace falta que `HOST_DATA_DIR` sea una ruta absoluta.
  Sin carpeta de películas, el salón se activa con `MPV_SOCKET=/data/mpv.sock` en el `.env`.
- Mando a distancia: la página Salón (pensada para el móvil) pausa, salta, cambia el volumen y
  las pistas de audio y subtítulos, pasa al capítulo anterior o siguiente, y para (cierra la ventana de mpv). Lo que hace mpv llega en directo con Server-Sent
  Events, también si se toca con el ratón. En todas las páginas hay una barra con lo que se está viendo.
- Cortinilla de Cine Club: con un vídeo en `HOST_DATA_DIR/cortinilla.mp4`, las películas que
  empiezan desde el principio van precedidas de él (no al continuar ni al saltar a una escena).
  Cada uno la quita en Ajustes, y el mando tiene «Saltar a la película». No se sube al repo:
  `data/` está en `.gitignore`.
- Si no se ve nada: `systemctl --user status jellycartoon-mpv` y el Registro de la app.

### Música

Una carpeta de música ripeada de CD, en FLAC con sus etiquetas, que se escucha en el navegador.
Con `HOST_MUSIC_DIR="/ruta/a/la/musica"` en el `.env` se monta de solo lectura y aparece la
sección Música; en desarrollo se usa `MUSIC_DIR`.

- «Escanear carpeta» busca los FLAC de la carpeta y sus subcarpetas, y en segundo plano lee sus
  etiquetas. Solo se catalogan los que tienen etiqueta de álbum: las descargas de YouTube (que no
  la tienen, y cuyo nombre acaba con el id del vídeo, `[ix5Ntnavdgg]`) se dejan fuera solas.
- Cada carpeta es un álbum, y cada CD de un disco doble, uno aparte. El título sale de la etiqueta
  ALBUM; el artista, de ALBUMARTIST, o del artista de todas las pistas, o «Varios artistas».
- Las portadas se buscan en [MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API) (por el
  id del disco si el ripeador escribió `CDTOC`, como fre:ac; si no, por título y artista) y se
  descargan del [Cover Art Archive](https://musicbrainz.org/doc/Cover_Art_Archive/API) a
  `DATA_DIR/album-cover`. MusicBrainz admite una petición por segundo: la primera vez tarda.
- El buscador ([MiniSearch](https://lucaong.github.io/minisearch/)) busca en el navegador, mientras
  escribes, en artistas, álbumes y canciones, sin importar tildes ni pequeñas erratas.
- Los FLAC se mandan tal cual: los navegadores actuales los reproducen. La barra de abajo sigue
  sonando al cambiar de página, y se controla también desde la pantalla de bloqueo del móvil y los
  botones de los auriculares ([Media Session](https://developer.mozilla.org/docs/Web/API/Media_Session_API)).
- Entre canción y canción hay un pequeño silencio (el navegador no hace «gapless»).

#### Snapcast

La música también puede sonar en [Snapcast](https://github.com/badaix/snapcast), en los
altavoces que tengan snapclient (una Raspberry, Snapdroid en el móvil…). Con
`COMPOSE_PROFILES=snapcast` en el `.env` se arrancan dos servicios más, con la misma imagen:

- `snapserver`, con una fuente `pipe` en `HOST_DATA_DIR/snapfifo` (44,1 kHz, como los CD) y su
  estado en `HOST_DATA_DIR/snapserver`. Va en la red del host: los clientes conectan a los
  puertos 1704 (audio) y 1705/1780 (control). Se anuncia por mDNS a través del Avahi del host
  (monta `/run/dbus`); si el host no tiene Avahi, a los clientes se les da el nombre del equipo
  (`snapclient -h salon.local`).
- `mpv-music`, un mpv sin ventana que escribe en esa FIFO, como en la
  [guía de Snapcast](https://github.com/badaix/snapcast/blob/develop/doc/player_setup.md), y que
  la app controla por `HOST_DATA_DIR/mpv-music.sock`. Mantiene la salida abierta entre canciones,
  así que en Snapcast los álbumes suenan sin cortes.

La app se conecta además a la API de control de snapserver (puerto 1705, en
`host.docker.internal`): el botón 🔈 de la barra de Snapcast muestra sus clientes, conectados o
no, con su volumen y silencio, y permite cambiarles el nombre (vacío vuelve al del equipo). Lo que
se cambie desde otro sitio, como Snapdroid, se ve al momento.

En Música aparece entonces «Sonar en: Este dispositivo / Snapcast» (cada dispositivo recuerda el
suyo), y una barra con lo que suena en Snapcast, lo mande quien lo mande. Por el búfer de audio,
pausar o cambiar de canción tarda uno o dos segundos en oírse.

### Radio

Emisoras en directo de Reino Unido, Estados Unidos, Francia, Italia y España, para escuchar y
para acostumbrar el oído a otros idiomas. La lista está elegida a mano en `src/lib/radio.ts`
(primero las habladas de cada idioma) y no hace falta configurar nada.

- Cada emisora se guarda por su id en [Radio Browser](https://www.radio-browser.info), una base
  de datos comunitaria con [API pública](https://api.radio-browser.info). Al pulsar una se pide
  allí su stream actual: si la emisora lo cambia, sigue funcionando en cuanto la comunidad lo
  actualiza. El servidor de Radio Browser se elige por su registro DNS SRV, como pide.
- Suena en la misma barra que la música. Los streams MP3/AAC van tal cual; los HLS (BBC, Radio
  France, RTVE), con hls.js. Al reanudar tras una pausa se vuelve al directo.
- Para añadir una emisora: buscar su `stationuuid` en radio-browser.info y añadirla a la lista.

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
`compose.prod.yaml` y `.env` (necesita `jq` y `rsync`). Un HDD externo va bien: tras la primera
copia, `rsync` solo copia lo nuevo. La carpeta de destino tiene que existir ya (créala una vez en
el disco de la copia), así que con el disco desconectado no copia nada al disco interno; tampoco
copia al mismo disco que `HOST_DATA_DIR`:

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
