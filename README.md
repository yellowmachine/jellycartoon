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

Usa las imágenes que construye GitHub Actions (`ghcr.io/yellowmachine/jellycartoon`, `-caddy` y
`-backup`), en dos canales:

- **`stable`**, el que se usa por defecto: la última versión publicada. Cada _release_ de GitHub
  (`v1.2.0`) construye `1.2.0`, `1.2` y `stable`, con sus novedades en las notas del release.
- **`latest`**: cada push a `main`, para probar cambios. Se elige con `IMAGE_TAG=latest` en el `.env`.

En el servidor solo hacen falta `compose.prod.yaml` y un `.env` con:

```sh
ORIGIN="https://<tu-dominio>"            # URL desde la que se abre la app (la sirve Caddy)
CF_API_TOKEN="..."                       # token de Cloudflare para el certificado (ver abajo)
BETTER_AUTH_SECRET="..."                 # openssl rand -base64 32
HOST_MEDIA_DIR="/ruta/a/los/videos"
HOST_DATA_DIR="/ruta/a/los/convertidos"
```

```sh
docker compose -f compose.prod.yaml pull     # descarga las últimas imágenes
docker compose -f compose.prod.yaml up -d    # arranca o actualiza
docker compose -f compose.prod.yaml logs -f app
```

- `ORIGIN` se lee al arrancar: la misma imagen sirve en cualquier dirección. Si cambia, edita el
  `.env` y `docker compose -f compose.prod.yaml up -d`.
- La app solo escucha en `127.0.0.1:3000` del servidor. Delante va Caddy, que la sirve por HTTPS
  en el dominio de `ORIGIN` (puerto 443). Detrás de un proxy https,
  [adapter-node](https://svelte.dev/docs/kit/adapter-node) supone https por defecto, así que no
  hace falta `PROTOCOL_HEADER`.
- El dominio apunta a la IP de Tailscale del servidor: solo se llega desde la tailnet, pero el
  nombre lo resuelve cualquier DNS (no depende del DNS de Tailscale, que falla en algunos
  móviles). Como Let's Encrypt no llega al servidor, el certificado se pide con el reto DNS-01
  de Cloudflare ([caddy-dns/cloudflare](https://github.com/caddy-dns/cloudflare)); la imagen de
  Caddy con ese módulo (`Dockerfile.caddy`) la construye GitHub Actions junto a la de la app
  (`ghcr.io/yellowmachine/jellycartoon-caddy`, mismas etiquetas). Una vez:
  1. En Cloudflare, un registro `A` del dominio → IP de Tailscale del servidor
     (`tailscale ip -4`), en modo **DNS only** (sin proxy).
  2. Un token de API (My Profile → API Tokens) con `Zone.Zone:Read` y `Zone.DNS:Edit` sobre esa
     zona, en `CF_API_TOKEN`.
  3. Si estaba Tailscale Serve, liberar el 443: `sudo tailscale serve --https=443 off`.
  4. `docker compose -f compose.prod.yaml logs -f caddy` hasta ver `certificate obtained successfully`.
- Si `HOST_DATA_DIR` es una ruta absoluta, cada capítulo convertido tiene un botón ⧉ que copia
  la ruta de su `master.m3u8` para abrirlo en el mismo PC con mpv u otro reproductor
  (`mpv <ruta>`). Por http desde otra IP el navegador no deja copiar: muestra la ruta seleccionada.
- La app corre como `PUID:PGID` (por defecto `1000:1000`), que es el dueño de `HOST_DATA_DIR`.
- **Instalar en casa de otra persona** sin que pueda estropearlo: lo que la protege es que su
  usuario **no tenga `sudo` ni esté en el grupo `docker`**, que equivale a ser root
  ([documentación de Docker](https://docs.docker.com/engine/security/#docker-daemon-attack-surface)).
  Lo demás, de root y con un usuario propio para la app:
  ```bash
  sudo useradd --system --no-create-home --shell /usr/sbin/nologin jellycartoon
  id jellycartoon                                   # su uid y gid: PUID y PGID del .env
  sudo mkdir -p /opt/jellycartoon/data              # compose.prod.yaml y .env, de root
  sudo chown jellycartoon:jellycartoon /opt/jellycartoon/data && sudo chmod 750 /opt/jellycartoon/data
  sudo chmod 600 /opt/jellycartoon/.env             # secretos: sesiones, Cloudflare, OpenRouter
  # Lo que ella rellena, aparte: escribe ella y la app lee por el grupo
  sudo mkdir -p /srv/media/series && sudo chown <su-usuario>:jellycartoon /srv/media/series
  sudo chmod 2775 /srv/media/series
  ```
  Con `HOST_DATA_DIR=/opt/jellycartoon/data` y `HOST_MEDIA_DIR=/srv/media/series`. Crea tú la
  primera cuenta (la que administra) y luego `ALLOW_SIGNUP=false`; con el perfil `updates`, WUD
  actualiza solo.
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
- Las cuentas infantiles las crea quien creó la primera cuenta, desde Ajustes. Solo ven las series
  y películas con la etiqueta «infantil», no gestionan nada ni hablan con la IA, y la propia cuenta
  no puede dejar de ser infantil.
- En «Infantil» (para cualquier adulto) se ve lo que ven, y se les pone horario por días y un
  límite de minutos al día. Fuera de él no hay vídeo, tampoco en el salón: lo que suena se para.
  Las horas son las de `TZ`.
- «¿Sigues ahí?» (por niño, en «Infantil»: nunca, o cada 2, 3 o 4 capítulos; 3 si no se elige):
  tras esos capítulos seguidos empezados solos («siguiente automático» en el navegador, o la lista
  del mpv del salón) sin que nadie toque nada, el siguiente espera a que conteste. Si en 2 minutos
  nadie lo hace, se para, y «Ahora» dice a qué hora y por qué. Tocar algo pone la cuenta a cero: en
  el navegador, cualquier toque o tecla; en el salón, Play/Pausa, saltar, el menú, el micrófono o
  el mando del móvil. Allí la pregunta sale sobre el vídeo y se contesta con el OK. «Ahora» dice
  también la última vez que alguien tocó algo: «Última interacción a las 19:42, hace 3 minutos».
- En «Ahora», «Verlo en pequeño» abre al lado un vídeo sin sonido con lo que está viendo cada niño,
  en el mismo segundo y siguiéndolo: si salta, se recoloca; si pausa, se queda en ese fotograma
  (unos segundos tarde, cuando su posición deja de moverse). No es su pantalla, sino el mismo
  vídeo: un menú no se ve. Lo hace el servidor mientras está abierto, con un ffmpeg por niño, a
  360p y unos 250 kb/s (unos 110 MB por hora, una décima parte del vídeo); los canales, del propio
  canal, en su calidad más baja.
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
segundos. Hace falta una sesión gráfica iniciada (Wayland o X11) y mpv instalado. Se instala
desde este PC por SSH, con lo del mando (abajo, «Mando del salón»), usando las casas de
`scripts/casas.sh`:

```sh
scripts/pantalla.sh salon          # o padres=miguel@pc-padres, una que no está en la lista
```

Solo cambia lo que es distinto en el repositorio y enseña en qué. La ruta de `HOST_DATA_DIR` la
saca del contenedor de la app. Reinicia mpv solo si no hay nada puesto; si se está viendo algo,
lo avisa y no lo toca. Lo mismo a mano, en el PC de la pantalla, desde el repositorio y con la
ruta de `HOST_DATA_DIR`:

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
  esperando otra vez. Esc para, como «Parar» en el mando, en lugar de salir de pantalla completa:
  en un mando a distancia es «atrás».
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
- Si no la encuentra, casi siempre es por el nombre: «… CD1», «Lauper, Cyndi», «AC, DC». En el
  álbum, «Buscar carátula» le pide a la IA (con la clave de OpenRouter de Ajustes; sin ella, con
  el nombre tal cual) qué disco es, por su carpeta, su título, su artista y sus canciones, lo busca
  así en MusicBrainz y propone hasta 4 carátulas de las ediciones que la tienen. La elegida se
  guarda como las demás, una copia, con su id de MusicBrainz (`album.cover_source`), y también en
  los otros discos del mismo álbum sin portada («Sus 50 mejores canciones CD 1» y «CD 3»).
- El buscador ([MiniSearch](https://lucaong.github.io/minisearch/)) busca en el navegador, mientras
  escribes, en artistas, álbumes y canciones, sin importar tildes ni pequeñas erratas.
- Los FLAC se mandan tal cual: los navegadores actuales los reproducen. La barra de abajo sigue
  sonando al cambiar de página, y se controla también desde la pantalla de bloqueo del móvil y los
  botones de los auriculares ([Media Session](https://developer.mozilla.org/docs/Web/API/Media_Session_API)).
- Entre canción y canción hay un pequeño silencio (el navegador no hace «gapless»).
- «+ Añadir a la cola» en un álbum lo pone detrás de lo que suena, sin cortarlo. El botón de la
  cola (☰ con ▶︎) en la barra de abajo la abre: lo que suena, lo que viene y, en gris, lo que ya
  sonó; tocar una canción salta a ella y ✕ la quita. En el navegador, no en Snapcast todavía.
- Listas: en la pestaña «Listas» de Música se crean, renombran y borran listas de canciones,
  compartidas por toda la casa. El «+» de cada canción (en los álbumes y en el buscador) la añade a
  una lista, o a una nueva; una canción puede estar más de una vez. Dentro de la lista se ordena
  con ▲▼ y se quita con ✕, y suena aquí o en Snapcast como un álbum.

#### Snapcast

La música también puede sonar en [Snapcast](https://github.com/badaix/snapcast), en los
altavoces que tengan snapclient (una Raspberry, Snapdroid en el móvil…). Con
`COMPOSE_PROFILES=snapcast` en el `.env` se arrancan dos servicios más, con la misma imagen:

- `snapserver`, con una fuente `pipe` en `HOST_DATA_DIR/snapfifo` (44,1 kHz, como los CD) y su
  estado en `HOST_DATA_DIR/snapserver`. Va en la red del host: los clientes conectan a los
  puertos 1704 (audio) y 1705/1780 (control). Se anuncia por mDNS a través del Avahi del host
  (monta `/run/dbus`); si el host no tiene Avahi, a los clientes se les da la dirección del equipo
  (`snapclient tcp://salon.local:1704`, o con su IP si el nombre resuelve a una IPv6 `fe80::` que
  no conecta).
- **Cortafuegos:** al ir en la red del host, Docker no le abre puertos como hace con los publicados
  (`ports:`). Con ufw, por ejemplo, para la red local:
  `sudo ufw allow from 192.168.68.0/24 to any port 1704:1705 proto tcp`, lo mismo para el 1780, y
  `5353/udp` para que los clientes lo encuentren por mDNS. Si no, los clientes se quedan
  «Connecting…» sin error. La app también tiene que llegar al 1705, pero desde la red de Docker,
  no desde la local: con la subred que da
  `docker network inspect jellycartoon_default -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'`,
  `sudo ufw allow from 172.18.0.0/16 to any port 1705 proto tcp`. Si no, el panel 🔈 dice que no
  puede conectar con el control de snapserver.
- En un PC con PipeWire, el cliente va mejor con su salida por defecto: `snapclient -s default …`.
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
- Con Snapcast, la página Radio tiene también «Sonar en: Este dispositivo / Snapcast»: el mpv de
  la música abre el stream (por eso `mpv-music` tiene red) y la barra de Snapcast muestra lo que la
  emisora dice que suena, si lo dice (su título ICY; WNYC, por ejemplo, sí; muchas, no).
- Se usa el enlace propio de cada emisora, que puede redirigir con un token nuevo cada vez (como el
  de RTVE); el ya resuelto, solo si el enlace es un fichero de lista (`.pls`, `.m3u`).
- Para añadir una emisora: buscar su `stationuuid` en radio-browser.info y añadirla a la lista.

### Voz

Órdenes habladas desde el móvil (#33), pensadas para personas mayores: en `/voz`, un botón grande
que se mantiene pulsado mientras se habla, como los audios de WhatsApp. También se puede escribir
la orden, para probar una frase.

Lo que se dice pasa a texto con Whisper (abajo) y de ahí a un modelo de OpenRouter, con la clave de
Ajustes y su «Modelo para la voz» (por defecto, Claude Haiku 5.5: rápido, y bueno eligiendo
herramientas). El modelo tiene las acciones de la app como herramientas: buscar en la música, poner
un artista, álbum, lista o canción, poner una emisora, pausar, seguir, siguiente, anterior, parar
y el volumen de toda la casa.

- **Dónde**: aquí (el dispositivo, que lo pone en su propia barra) o toda la casa (Snapcast, si
  está). Sin decirlo, aquí.
- **La respuesta**, una frase corta, se ve en grande y se lee en voz alta con la voz del propio
  dispositivo (`speechSynthesis`). Si duda entre pocas opciones, pregunta con botones; si no
  encuentra algo, lo dice y propone lo más parecido.
- Recuerda los últimos turnos: «no, eso no, los Pegamoides» funciona.
- La biblioteca, las listas y las emisoras van en sus instrucciones, que se cachean; con Haiku 5.5,
  unos 0,0003 $ por orden y unos 2 s. El coste de cada una queda en el Registro.

Con `voz` en `COMPOSE_PROFILES` y `WHISPER_MODEL` en el `.env` arranca el servicio `whisper`: el
servidor de [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (`whisper-server`, de su imagen
oficial para Vulkan) en la GPU, en español.

- La primera vez descarga el modelo al volumen `whisper_models` (`small`, unos 490 MB). `medium`
  entiende mejor, a cambio de más memoria y más tiempo.
- Solo lo alcanza la app, por la red de Docker: no publica puertos. El audio no sale de casa.
- Convierte con ffmpeg lo que graba el navegador: WebM/Opus en Android, MP4/AAC en iPhone.
- El micrófono del navegador necesita HTTPS, que ya da Caddy.
- La imagen va fijada a la de una versión (v1.9.5) y WUD no la actualiza: se cambia a mano en el
  compose.

#### Mando del salón

Un mando con micrófono (el del salón es un GREVA G20S Pro, con receptor USB) para la vista TV. Las
flechas mueven el foco y su Volver es el del navegador, pero varias de sus teclas son de mando a
distancia y no llegan a Chromium: el OK es `KEY_SELECT` y el micrófono `KEY_VOICECOMMAND`, con
códigos por encima de 255, que las aplicaciones de escritorio no reciben; Play/Pausa llega sin
identificar, e Inicio (`BrowserHome`) saca de la app. Se traducen solo para ese mando con un
fichero de [hwdb de udev](https://man.archlinux.org/man/hwdb.7), `deploy/70-mando-g20s.hwdb`:

```
# El receptor del mando: bus USB (0003), fabricante y producto de `lsusb`
evdev:input:b0003v4842p0001*
 KEYBOARD_KEY_c0041=enter   # OK
 KEYBOARD_KEY_c00cd=f8      # Play/Pausa
 KEYBOARD_KEY_c00cf=f9      # Micrófono
 KEYBOARD_KEY_c0223=f7      # Inicio
```

`scripts/pantalla.sh` lo instala si el receptor está enchufado, y pide ahí la contraseña de
`sudo` de esa casa. A mano, desde el repositorio:

```sh
sudo cp deploy/70-mando-g20s.hwdb /etc/udev/hwdb.d/
sudo systemd-hwdb update && sudo udevadm trigger --sysname-match="event*"
```

(O volver a enchufar el receptor en lugar de `udevadm trigger`). Con otro mando, sus scancodes
salen de `evtest` (con `sudo`). En la vista TV: el OK
entra en lo que tiene el foco, F7 vuelve a su portada, F8 pausa o sigue lo que suena (el mpv del
salón, o la música, la radio o el podcast del navegador) y F9 habla: un toque empieza y otro
envía, porque el mando manda su tecla pulsada y soltada a la vez, y lo que oye y contesta se ve en
grande. Con el puntero del mando (modo ratón) apagado, para que mueva el foco. El micrófono del
mando es una tarjeta de sonido USB más, y el del sistema si no hay otro.

Si una tecla no hace lo que debe, `?depurar` en la dirección (`/tv?depurar`) pone encima de la
vista TV qué teclas llegan, a dónde va el foco (con un marco), si la página se desplazó en su
lugar y cada paso de la voz: escuchando y cuánto, enviando, qué oyó y qué contestó. Sigue en esa
ventana al cambiar de página, hasta `?depurar=no`. Como la ventana de la app no tiene barra de
direcciones, en el salón hay otro lanzador igual con esa dirección, «JellyCartoon (depurar)»
(`~/.local/share/applications/jellycartoon-depurar.desktop`, el mismo `Exec` con `/tv?depurar` y
otra `--class`).

Con algo en el mpv del salón a pantalla completa, las teclas le llegan a él, y se configuran en
`deploy/mpv/`: `input.conf` (qué hace cada tecla) y `scripts/mando.lua` (el menú). También
los instala `scripts/pantalla.sh`. A mano, desde el repositorio y con mpv sin nada puesto:

```sh
mkdir -p ~/.config/mpv/scripts
cp deploy/mpv/input.conf ~/.config/mpv/
cp deploy/mpv/scripts/mando.lua ~/.config/mpv/scripts/
systemctl --user restart jellycartoon-mpv
```

| Tecla del mando | En el mpv del salón                                             |
| --------------- | --------------------------------------------------------------- |
| OK o Menú       | Abre el menú; dentro, elige; con «¿Sigues ahí?», contesta       |
| Flechas         | En el menú, se mueven; sin menú, saltan 5 s (← →) o 1 min (↑ ↓) |
| Volver          | Cierra el menú; sin menú, para y se vuelve a la vista TV        |
| Play/Pausa      | Pausa o sigue                                                   |
| Inicio          | Para y se vuelve a la vista TV                                  |
| Micrófono       | Habla, como en la vista TV; el vídeo se pausa mientras tanto    |
| Números         | Nada                                                            |
| Vol+ / Vol−     | El volumen del sistema (no llegan a mpv)                        |

- **El menú** tiene solo «Subtítulos» y «Audio», en español; si solo hay una de las dos cosas
  para elegir, va directo a ella. Los subtítulos empiezan por «Sin subtítulos», y las pistas se
  llaman como en la página Salón del móvil (`Español · 5.1`, `English · forzados`); ● es la que
  está puesta. Al elegir, mpv lo dice abajo un momento. El menú de mpv (`select/menu`, su tecla
  Menú por defecto) no sirve para esto: trae también atajos, ficheros de configuración,
  historial... y su lista está fija en su código. `mando.lua` usa lo mismo que él
  ([`mp.input`](https://mpv.io/manual/stable/#mp-input-functions)), así que se maneja igual.
- **Volver** es `keypress ESC` y no `stop` porque los menús de mpv solo se cierran con Esc: con
  `stop` paraba el vídeo desde dentro del menú. Sin menú, Esc para por el servicio
  (`keybind ESC stop` en `deploy/jellycartoon-mpv.service`).
- **OK** por defecto en mpv pasa al siguiente de la lista (`playlist-next`): un toque sin querer
  saltaba al capítulo siguiente.
- **Los números**: el mando tiene teclado numérico, y en mpv cambian contraste, brillo, gamma,
  saturación y volumen; un toque sin querer oscurece la imagen hasta reiniciar mpv. Dentro del
  menú, en cambio, escriben para filtrar la lista (como todo lo que se escribe en él); Volver lo
  cierra igual.
- **El micrófono** (F9) con mpv delante: `script-message jellycartoon-voz`. mpv lo cuenta a quien
  esté en su socket, la app, y la vista TV del navegador, debajo, escucha como siempre: «Langua dos
  minutos» manda lo que se está viendo. Lo que dice la caja de la voz sale escrito sobre el vídeo,
  que se pausa hasta que acaba de leer la respuesta. Si contesta con una pregunta, se responde con
  el micrófono: los botones están en el navegador, tapados.
- Para ver qué tecla le llega a mpv (sin `sudo`): `mpv --input-test --force-window --idle` en la
  sesión gráfica, que dice el nombre de cada una en pantalla.

Volver es `keypress ESC` y no `stop` porque el menú de mpv solo se cierra con Esc.

Con una RX 7800 XT, una orden de unos segundos tarda alrededor de 150 ms.

## Copia de seguridad

Qué hay que guardar:

- **Base de datos**: usuarios, progreso, listas, títulos y numeración cambiados a mano. Se copia
  con [`pg_dump`](https://www.postgresql.org/docs/current/app-pgdump.html), no copiando el
  volumen.
- **`HOST_DATA_DIR`**: los vídeos convertidos y las miniaturas. Va con la base de datos (cada
  episodio es `hls/<id>`). Con `DELETE_SOURCES=true` es la única copia de los vídeos.
- **`.env`**: la configuración y las claves (`BETTER_AUTH_SECRET`, la de Cloudflare, las de R2…).
  Guárdalo en tu gestor de contraseñas, como nota segura. Nunca en git, ni en una nube sin cifrado de
  extremo a extremo. Perderlo no es grave (las claves se pueden volver a crear); que se filtre, sí: si
  pasa, cambia las de Cloudflare, R2 y OpenRouter, `WUD_PASSWORD` y `BETTER_AUTH_SECRET`.
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

### Copia en Cloudflare R2

Con el perfil `backup`, cada noche se sube la base de datos a un bucket de
[R2](https://developers.cloudflare.com/r2/). Antes de salir del equipo se cifra con
[age](https://age-encryption.org): el servidor solo tiene la clave pública, que cifra pero no
descifra, y la privada la guardas tú aparte. Solo va la base de datos (unos MB), no los vídeos; la
copia completa sigue siendo `scripts/backup.sh`.

Una vez, en Cloudflare (R2 en el panel):

1. **Crea un bucket**, por ejemplo `jellycartoon`, con location **Automatic** (no una jurisdicción
   como la UE, que usa otra dirección) y storage class **Standard**: es la que entra en la capa
   gratuita, y Infrequent Access cobra cada descarga y un mínimo de 30 días por fichero.
2. **En el bucket, Settings → Object lifecycle rules**: una regla que borre los objetos de más de 30
   días, limitada al prefijo `backups/`. Así las copias viejas se van solas, y nada más del bucket.
3. **R2 → Manage API tokens → Create API token**, con el permiso **Object Read & Write** y solo
   **ese bucket**. Apunta el _Access Key ID_, el _Secret Access Key_ y el _Account ID_.

En tu ordenador, la clave para cifrar (`age-keygen` viene con [age](https://github.com/FiloSottile/age)):

```sh
age-keygen -o jellycartoon-copias.key
```

Guarda el fichero entero en tu gestor de contraseñas: sin él no se pueden leer las copias. La línea
`# public key: age1…` es la que va en el `.env`:

```sh
COMPOSE_PROFILES="updates,backup"   # los que uses, separados por comas
R2_ACCOUNT_ID="..."
R2_ACCESS_KEY_ID="..."
R2_SECRET_ACCESS_KEY="..."
R2_BUCKET="jellycartoon/backups"      # bucket y carpeta (prefijo): aparece sola con la primera copia
BACKUP_AGE_RECIPIENT="age1..."
# BACKUP_TIME="03:30"               # a qué hora (la de TZ)
```

Las claves de R2 van, como el resto del `.env`, en el gestor de contraseñas; la de age también, en
la misma nota o en otra.

Para probarla sin esperar a la noche:

```sh
docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml run --rm backup now
```

La copia aparece en el bucket como `backups/jellycartoon-<fecha UTC>.dump.age`. Si una noche no se sube,
`docker compose -f compose.prod.yaml ps backup` la muestra _unhealthy_ al día siguiente, y
`logs backup` dice por qué. Para restaurar, descarga la copia desde el panel de R2, descífrala y
sigue los pasos de arriba con el fichero que sale:

```sh
age -d -i jellycartoon-copias.key jellycartoon-<fecha>.dump.age > jellycartoon.dump
```

Si una copia falla y el log no basta, esto enseña cada petición a R2 y su respuesta, sin claves ni
firmas:

```sh
docker compose -f compose.prod.yaml run --rm -e RCLONE_DUMP=headers -e RCLONE_VERBOSE=2 backup now 2>&1 \
  | grep -E ': (PUT|POST|GET|HEAD|DELETE) |: HTTP/1|Subida|Attempt'
```

## Actualizaciones

Con el perfil `updates`, [WUD (What's Up Docker)](https://github.com/getwud/wud) instala cada versión
nueva del canal `stable`: de madrugada, o cuando el administrador lo pide desde la app. En el `.env`:

```sh
COMPOSE_PROFILES="updates"        # o "snapcast,updates"
WUD_PASSWORD="..."                # contraseña del usuario admin de WUD; sin «:»
# UPDATE_CRON="0 4 * * *"         # cuándo mira si hay versión nueva (por defecto, a las 4:00)
```

- **El aviso:** la app compara su versión con el último release de GitHub. Al administrador le sale
  un aviso arriba y, en Ajustes → Versión, las novedades y el botón «Actualizar ahora».
- **Antes de actualizar**, WUD hace una copia de la base de datos en `update-backups/`, junto al
  compose, con la hora en UTC en el nombre, y guarda las cuatro últimas. Si la copia falla, no
  actualiza.
- **Si la versión nueva no arranca sana**, vuelve a la anterior. Para deshacer una actualización
  que sí arrancó, con la imagen anterior (`IMAGE_TAG=1.1.0`) y esa copia: el `pg_restore` de
  arriba con el fichero de `update-backups/`, y `up -d`.
- **Solo toca** los servicios con la etiqueta `wud.watch=true` (la app, Caddy, Snapcast y la copia en
  R2), nunca Postgres. Su web está en `http://127.0.0.1:3001`, solo en el propio equipo.
- **Control de Docker:** WUD necesita el socket de Docker, así que quien controla WUD controla los
  contenedores del equipo. Por eso su web no sale del equipo y lleva contraseña.
- **Limitación:** después de una vuelta atrás, WUD deja de seguir a la app, porque la imagen
  anterior se queda sin la etiqueta `stable`. Hasta el próximo
  `docker compose -f compose.prod.yaml pull` y `up -d` hechos a mano, no se actualiza sola.

### Publicar una versión

1. **PR de `development` a `main`**, y merge.
2. **Un release en GitHub sobre `main`**, con la versión como `vX.Y.Z` (tres números): _patch_ para
   arreglos, _minor_ para novedades, _major_ si algo deja de funcionar como antes. Las notas, en
   español: son las que ve el administrador en el aviso de la app. No lo marques como _pre-release_,
   o no mueve `stable`. Desde la web (Releases → Draft a new release) o con:

   ```sh
   gh release create v1.2.0 --target main --title "1.2.0" --notes "…"
   ```

3. **Espera a que Actions construya las imágenes** (unos minutos). Desde ahí, WUD las instala esa
   madrugada, o el administrador con «Actualizar ahora».

WUD actualiza las imágenes, nunca `compose.prod.yaml` ni el `.env`. Si un cambio necesita tocarlos,
dilo en las notas («requiere actualizar el compose»): en cada casa hay que traer el compose nuevo
(`git pull`), completar el `.env` y hacer `pull` y `up -d`.

Una imagen nueva (como lo fue `-backup`) puede quedar privada en GitHub la primera vez. Si `pull`
dice _denied_, en GitHub: Packages → la imagen → Package settings → Change visibility → Public.

## Pendiente

- Control remoto (dispositivos + comandos play/pause/seek por SSE).
- Subtítulos de imagen (VobSub/PGS): OCR.
- Telecine inverso para DVD de dibujos rodados en película.
- Metadatos/pósters (TMDB) y edición manual de títulos.
