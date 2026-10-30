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

`bun install` deja puestos los hooks de git (Husky, en `.husky/`): antes de cada commit, Prettier
formatea lo que va en él y pasan los tests; antes de cada push, `svelte-check`.

## Producción

Usa las imágenes que construye GitHub Actions (`ghcr.io/yellowmachine/jellycartoon`, `-caddy` y
`-backup`), en dos canales:

- **`stable`**, el que se usa por defecto: la última versión publicada. Cada _release_ de GitHub
  (`v1.2.0`) construye `1.2.0`, `1.2` y `stable`, con sus novedades en las notas del release.
- **`latest`**: cada push a `main`, para probar cambios. Se elige con `IMAGE_TAG=latest` en el `.env`.

### Instalar

En un PC con Linux y Docker (x86_64), en una terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/yellowmachine/jellycartoon/main/install.sh | sh
```

`install.sh` lo deja todo en `~/jellycartoon`: descarga `compose.prod.yaml`, pregunta cómo se llega
(con el nombre del PC o con un dominio en Cloudflare, ver [Solo en casa](#solo-en-casa)), la
carpeta de los capítulos y los extras (actualizar cada noche, la voz), escribe el `.env` con sus
secretos, arranca y dice la dirección exacta. Se puede ejecutar otra vez sin miedo: no pisa ningún
fichero, y con `.env` solo arranca. En Aurora o Bazzite sin DX (sin Docker) explica cómo pasar a
DX y para; si el usuario está en el grupo `docker`, avisa (ver «Instalar en casa de otra persona»).
Y en el crontab de ese usuario, una vez, los domingos a las 5:00, borra las imágenes de Docker que
dejan las actualizaciones (`docker image prune -f --filter until=168h`, solo las de hace más de una
semana): cada una son unos 2 GB, y ni Docker ni WUD las borran.

A mano, en el servidor solo hacen falta `compose.prod.yaml` y un `.env` con:

```sh
ORIGIN="https://<nombre-o-dominio>"      # URL desde la que se abre la app (la sirve Caddy)
TLS="internal"                           # o sin él, con CF_API_TOKEN: ver «Solo en casa»
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
  en el nombre de `ORIGIN` (puerto 443). Detrás de un proxy https,
  [adapter-node](https://svelte.dev/docs/kit/adapter-node) supone https por defecto, así que no
  hace falta `PROTOCOL_HEADER`.
- La app solo se abre en la red de casa. Desde fuera solo se llega a las APIs para otras apps
  (la música por Subsonic y la de Seilide), por un túnel de rathole: ver
  [Las APIs desde fuera](#las-apis-desde-fuera-con-rathole).
- El certificado, con un dominio, lo pide Caddy a Let's Encrypt con el reto DNS-01 de Cloudflare
  ([caddy-dns/cloudflare](https://github.com/caddy-dns/cloudflare)), porque Let's Encrypt no
  llega a casa. La imagen de Caddy con ese módulo (`Dockerfile.caddy`) la construye GitHub
  Actions junto a la de la app (`ghcr.io/yellowmachine/jellycartoon-caddy`, mismas etiquetas). Hace
  falta un token de API de Cloudflare (My Profile → API Tokens) con `Zone.Zone:Read` y
  `Zone.DNS:Edit` sobre la zona del dominio, en `CF_API_TOKEN`; la primera vez,
  `docker compose -f compose.prod.yaml logs -f caddy` hasta ver `certificate obtained successfully`.
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
  primera cuenta (la que administra): las demás las crea ella en Ajustes; con el perfil `updates`,
  WUD actualiza solo.
- Para fijar una versión concreta: `IMAGE_TAG=sha-abc1234` en el `.env`.
- `DELETE_SOURCES=true` borra de `HOST_MEDIA_DIR` cada original (y sus subtítulos externos) en
  cuanto se convierte; el episodio sigue en el catálogo. Útil si guardas copia en otro disco.
  Los ficheros modificados hace menos de un minuto se ignoran al escanear (copias en curso).
  En Biblioteca aparece un botón para borrar los que ya estaban convertidos. Ojo: para
  reconvertir (cambios de formato o de calidad) habrá que volver a copiar los originales.
- **Versión ligera (720p)**, para el móvil o la tablet fuera de casa: con «Seleccionar capítulos» →
  «Versión ligera (720p) · Crear», cada capítulo convertido tiene también su vídeo a 720p y unos
  2 Mbps (`hls/<id>/video-720`), con el mismo audio y subtítulos; «Quitar» la borra. Se hace a
  partir de lo convertido, sin el original, en la misma cola que las conversiones (cuando no queda
  nada por convertir, y se pausa con ella); un capítulo de 22 minutos tarda unos 3 en el PC del
  salón. Los que se conviertan con el vídeo por encima de 5 Mbps (Friends en Blu-ray va a 15) la
  piden solos. En el reproductor, «Calidad: Automática / Ligera (720p)», que recuerda cada
  aparato: en automático elige la mejor que permita la conexión, y con un buen 5G también la de
  15 Mbps; en ligera, nunca más. El mpv del salón coge siempre la mejor.
- «Borrar capítulo…» (en el menú de cada uno, o varios con «Seleccionar capítulos») los borra para
  siempre, original de `HOST_MEDIA_DIR` incluido, para que el escaneo no los vuelva a traer: útil
  para la basura que viene con lo bajado de YouTube. Lo que la IA marca como «no es un episodio» va
  a la temporada 0, y ahí se selecciona entera.
- **Cuentas** (#157): en una instalación nueva, la página de entrada solo deja crear la primera
  cuenta, la del administrador; creada, el registro se cierra solo. El administrador crea las demás
  en Ajustes → Casa → Personas de la casa, adultos y peques, cada una con su dibujo. Un adulto se
  crea sin contraseña: la app da un QR y un enlace, de un solo uso y que vale 48 horas, con el que
  esa persona elige la suya y entra (`/bienvenida`). Se enseña el QR en la pantalla o se manda el
  enlace por WhatsApp; solo funciona en la wifi de casa. «Nuevo enlace para entrar»
  hace otro (el anterior deja de valer), también para quien ha olvidado su contraseña. El
  administrador nunca la sabe. `ALLOW_SIGNUP` ya no se usa.
- "Hoy" usa `TZ` (por defecto `Europe/Madrid`).
- **Entrar con Seilide** (#279): con `NUBE_URL`, `NUBE_CLIENT_ID` y `NUBE_CLIENT_SECRET` en el
  `.env` (los da Seilide, en Ajustes → Familia → «Entrar en casa con Seilide», a quien la
  administra), la página de entrada tiene «Entrar con Seilide»: una sola cuenta, la de Seilide, con
  su contraseña y su segundo paso, y aquí no se pide `/verificacion`. Solo entran los de esa
  familia. La primera vez, quien ya tiene cuenta en casa queda unido por su email y su contraseña
  de casa se borra; la del administrador se queda, por si Seilide no responde. Quien no tiene
  cuenta en casa la estrena como adulto normal: los papeles (administrador, infantil) son de casa.
  Los peques, la tele con el móvil, los satélites y la música (Subsonic) siguen igual. Es
  `genericOAuth` de Better Auth (`src/lib/server/nube-login.ts`); tras cambiar el `.env`,
  `docker compose -f compose.prod.yaml up -d`.
- **Verificación en dos pasos**: tras la contraseña, un código de 6 cifras de una app (Proton Pass,
  Google Authenticator, Aegis…), con «Recordar este dispositivo» 90 días y 10 códigos de
  recuperación de un solo uso. Cualquier cuenta la activa en Ajustes → Cuenta. Quien creó la
  primera cuenta (la que administra) la lleva siempre: la primera vez que entra sin ella, la app le
  pide configurarla antes de nada (las sesiones ya abiertas, como la de la tele, siguen igual). Las
  infantiles no la tienen.
- Si alguien pierde la app y sus códigos de recuperación, se le quita desde el servidor, y vuelve a
  entrar solo con la contraseña (al administrador se le pide configurarla otra vez):
  ```sh
  docker compose -f compose.prod.yaml exec app bun run quitar-2fa su@email
  ```
- Las cuentas infantiles las crea el administrador, en Personas de la casa. Solo ven las series
  y películas con la etiqueta «infantil», no gestionan nada ni hablan con la IA, y la propia cuenta
  no puede dejar de ser infantil.
- Los más pequeños entran **con permiso**, sin contraseña (#141). En Ajustes → Casa se marca un
  dispositivo como «de la casa» (la TV del salón): ahí, sin sesión, sale «¿Quién eres?» con sus
  dibujos, y al elegir uno sus padres o tutores lo ven en la app y contestan: esta vez, 1 hora,
  2 horas, hoy, o no. Mientras dure el permiso vuelve a entrar en ese dispositivo sin preguntar.
  Con «Activar avisos en este dispositivo» (Ajustes → Este dispositivo) les llega aunque la app esté
  cerrada; en el iPhone, solo con la app añadida a la pantalla de inicio. Las claves de los avisos
  (VAPID) las crea la app y las guarda cifradas: no hay nada que poner en el `.env`.
- Los **adultos entran en la tele desde el móvil** (#172), como en Steam. En «¿Quién eres?» salen
  también sus dibujos (los de quien ya eligió su contraseña). Al elegir uno, la tele enseña un QR y a
  esa persona le llega un aviso al móvil. Con su sesión abierta allí, dice que sí («¿Entrar en la
  TV del salón?») y la tele entra con su cuenta, en una sesión propia. Solo esa persona puede decir
  que sí: si otro lee el QR, se le dice para quién es. Solo pasa en los dispositivos de la casa, y
  el código caduca a los 3 minutos. Por debajo es el magic link de Better Auth, que el servidor hace
  y gasta en la petición de la tele, sin mandarlo; sus rutas públicas están desactivadas. Por eso
  los emails de la casa cuentan como verificados: los pone el administrador. «Entrar con contraseña»
  sigue ahí. Las sesiones de los adultos duran 30 días y se renuevan con el uso.
- **Ver juntos** (#160): en el aviso salen también, en gris, los demás peques que pueden unirse;
  los que se tocan entran con él. Después, desde «Ahora» (Infantil), se añaden o quitan tocándolos,
  también con el vídeo puesto. Un peque que está viendo algo en otro dispositivo (su tablet) no sale
  para unirse. Lo que ven cuenta para cada uno desde que se une (su tiempo, su historial y «Seguir
  viendo», por el minuto en que va), los límites son los del más estricto y, si a uno se le acaba,
  se para para todos y se dice a quién. «¿Sigues ahí?» sale con el número más bajo. En la tele se
  ve quién está viendo. Dura hasta el final del día o de esa sesión: en su propio dispositivo, cada
  uno ve solo.
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
  Los adultos también pueden tenerlo, para cuando se duermen con la serie: en Ajustes →
  Reproducción, cada uno el suyo (nunca si no se elige).
- En «Ahora», «Verlo en pequeño» abre al lado un vídeo sin sonido con lo que está viendo cada niño,
  en el mismo segundo y siguiéndolo: si salta, se recoloca; si pausa, se queda en ese fotograma
  (unos segundos tarde, cuando su posición deja de moverse). No es su pantalla, sino el mismo
  vídeo: un menú no se ve. Lo hace el servidor mientras está abierto, con un ffmpeg por niño, a
  360p y unos 250 kb/s (unos 110 MB por hora, una décima parte del vídeo); los canales, del propio
  canal, en su calidad más baja.
- `compose.yaml` es solo para desarrollo (Postgres con el puerto abierto). Ambos ficheros
  comparten la base de datos; usa uno u otro, no los dos a la vez.

### Las APIs desde fuera, con rathole

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

#### La API de vídeo, para Seilide

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

### Solo en casa

La app **solo funciona conectado a la wifi (o la red) de casa: fuera de ella no se llega**, ni con
datos móviles. Quien la use debe saberlo. Fuera, lo de la familia está en Seilide.

Hace falta HTTPS igualmente: sin él, el navegador no deja usar el micrófono (las órdenes de voz) y
no guarda la sesión (sus cookies son `Secure`). Hay dos formas de tener un certificado:

|                     | A. Certificado propio                       | B. Dominio con la IP de casa (recomendada)  |
| ------------------- | ------------------------------------------- | ------------------------------------------- |
| Hace falta          | Nada más                                    | Un dominio (unos 10 € al año) en Cloudflare |
| En cada dispositivo | Instalar la raíz de Caddy, una vez          | Nada                                        |
| Teles, Chromecast…  | A menudo no se puede instalar               | Funciona                                    |
| Dirección           | Un nombre de la red de casa (`salon.local`) | El dominio (`jelly.tudominio.es`)           |

En las dos:

- **Una IP fija para el PC** en la red de casa: en el router, «reserva DHCP» (o «IP estática») para
  ese equipo. Si cambiara, el nombre dejaría de llevar a él.
- `docker compose -f compose.prod.yaml up -d` y, la primera vez,
  `docker compose -f compose.prod.yaml logs -f caddy` para ver que saca el certificado.

#### A. Certificado propio de Caddy

Caddy crea su propia autoridad de certificación y firma con ella el certificado de la app (lo renueva
solo). Cada dispositivo tiene que fiarse de esa autoridad instalando su raíz, una sola vez: vale 10
años.

1. **Un nombre en la red de casa.** Con una IP no sirve: el navegador no dice a qué nombre va y
   Caddy no sabe qué certificado dar. Lo más sencillo es el nombre del PC con `.local`, que Linux
   anuncia solo por mDNS (Avahi, `sudo systemctl enable --now avahi-daemon`) y que entienden
   Windows, Mac, iPhone y los Android recientes: si el PC se llama `salon`, `salon.local`. Si el
   router deja poner nombres a los equipos de la red, también vale uno de ahí.
2. En el `.env`:
   ```sh
   ORIGIN="https://salon.local"
   TLS="internal"
   ```
   Sin `CF_API_TOKEN`.
3. Arranca, y saca la raíz de Caddy (la pública: **nunca** `root.key`):
   ```sh
   docker compose -f compose.prod.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt jellycartoon-raiz.crt
   ```
4. **En cada dispositivo**, instálala como autoridad de confianza (pásala por correo, una memoria o
   la red):
   - **Windows:** doble clic → «Instalar certificado» → «Equipo local» → «Colocar todos los
     certificados en el siguiente almacén» → «Entidades de certificación raíz de confianza».
   - **Mac:** doble clic (se abre Acceso a Llaveros, en «Sistema») → doble clic en «Caddy Local
     Authority» → «Confiar» → «Confiar siempre».
   - **Linux:** `sudo cp jellycartoon-raiz.crt /usr/local/share/ca-certificates/ && sudo
update-ca-certificates` (en Fedora o Arch, `sudo trust anchor jellycartoon-raiz.crt`).
     Firefox usa su propio almacén: Ajustes → Privacidad y seguridad → Certificados → Importar.
   - **iPhone y iPad:** abrir el fichero (desde Correo o Archivos) → Ajustes → «Perfil descargado» →
     Instalar. Y después, **imprescindible**: Ajustes → General → Información → Ajustes de
     confianza de certificados → activar «Caddy Local Authority».
   - **Android:** Ajustes → Seguridad (o «Cifrado y credenciales») → Instalar un certificado →
     «Certificado de CA», y aceptar el aviso. Chrome se fía de él; muchas apps, no.
   - **Teles y otros aparatos:** casi nunca dejan instalar una autoridad. Para la tele, mejor un PC
     conectado (como el del salón) o la opción B.
5. Abre `https://salon.local`: sin la raíz instalada, el navegador avisa de que la conexión no es
   segura. No hay que aceptar el aviso, sino instalar la raíz.

Si se borra el volumen de Caddy (`caddy_data`), crea otra autoridad y hay que volver a instalar la
raíz en todos los dispositivos.

#### B. Un dominio que apunta a la IP de casa

El dominio apunta a la IP del PC **en la red de casa**. Desde
fuera esa dirección no lleva a ningún sitio (es una IP privada), y en casa da un certificado de
verdad de Let's Encrypt: no hay que instalar nada en ningún dispositivo.

1. En Cloudflare, un registro `A` del dominio (por ejemplo `jelly.tudominio.es`) → la IP del PC en
   casa (`192.168.1.50`, la de `ip -4 addr`), en modo **DNS only** (sin proxy).
2. El token de API de Cloudflare (`Zone.Zone:Read` y `Zone.DNS:Edit`, ver [Producción](#producción)).
3. En el `.env`:
   ```sh
   ORIGIN="https://jelly.tudominio.es"
   CF_API_TOKEN="..."
   ```
   (`TLS` no hace falta: `cloudflare` es lo que hay por defecto.)
4. Si en casa el nombre no lleva a ningún sitio: algunos routers (FRITZ!Box, por ejemplo) y algunos
   DNS con filtros bloquean los nombres públicos que dan una IP privada, por si fuera un ataque
   («DNS rebinding»). En el router se añade el dominio como excepción («protección DNS rebinding»);
   o se usa otro DNS. Para comprobarlo, `nslookup jelly.tudominio.es` en un equipo de casa tiene
   que dar la IP del PC.

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
- Si OpenRouter dice que se acabó el crédito, la app deja de pedirle nada (falla al momento, sin
  salir a internet, también tras reiniciar) y a quien la administra le sale un banner arriba para
  recargarlo, con «Ya he recargado», que vuelve a dejar pasar las peticiones. Poner otra clave en
  Ajustes también. La voz contesta que se acabó el crédito, con Piper.

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
- `pulseaudio`, que escribe la música en esa FIFO, como en la
  [guía de Snapcast](https://github.com/badaix/snapcast/blob/develop/doc/player_setup.md)
  (`module-pipe-sink`), y mezcla encima las respuestas de los satélites de voz (más abajo).
- `mpv-music`, un mpv sin ventana que suena en ese PulseAudio, y que la app controla por
  `HOST_DATA_DIR/mpv-music.sock`. Mantiene la salida abierta entre canciones, así que en Snapcast
  los álbumes suenan sin cortes.

La app se conecta además a la API de control de snapserver (puerto 1705, en
`host.docker.internal`): el botón 🔈 de la barra de Snapcast muestra sus clientes, conectados o
no, con su volumen y silencio, y permite cambiarles el nombre (vacío vuelve al del equipo). Lo que
se cambie desde otro sitio, como Snapdroid, se ve al momento.

En Música aparece entonces «Sonar en: Este dispositivo / Snapcast» (cada dispositivo recuerda el
suyo), y una barra con lo que suena en Snapcast, lo mande quien lo mande. Por el búfer de audio,
pausar o cambiar de canción tarda uno o dos segundos en oírse.

Los capítulos también pueden sonar solo con su audio en Snapcast (#223), por ejemplo para dormirse
con una serie en el dormitorio: en el «⋯» del capítulo, o en el menú del reproductor desde el
segundo en que vas, «🔈 Solo el audio, por Snapcast», en toda la casa o solo en un altavoz; o por
voz («pon Friends en el dormitorio»). Siguen los siguientes de la serie (con «siguiente
automático») y se guarda por dónde vas, como si lo vieras. Tras los capítulos seguidos de
«¿Sigues ahí?» (Ajustes) sin tocar nada, se para: en un altavoz no hay quien conteste. El mpv de
Snapcast lee el audio del mismo HLS del capítulo, en `HOST_DATA_DIR/hls`.

Snapserver tiene además una segunda fuente, `Voz` (`HOST_DATA_DIR/snapvoz`), para que los
satélites de voz (#223) contesten por Snapcast: la misma música, con las respuestas encima, que
mezcla el PulseAudio (`deploy/pulse.pa`; Snapcast solo cambia de fuente, no mezcla). En Ajustes →
Casa → Satélites de voz se elige, por cada satélite, el altavoz de su habitación, donde baja la
música mientras te oye y contesta, y por dónde contesta: su propio altavoz, toda la casa o un
altavoz de Snapcast. La respuesta suena encima de la música, que baja (−12 dB, como en el móvil)
mientras habla, con un segundo de retraso, el del búfer. En toda la casa, en la misma música; en
un altavoz, ese pasa a `Voz` y luego vuelve a la música, con un corte de casi un segundo en cada
cambio (el de Snapcast al cambiar de fuente), y los demás siguen con ella tal cual. Después de actualizar,
termina con `docker compose -f compose.prod.yaml up -d`: hay un servicio nuevo, `pulseaudio`, y la
app necesita `SNAPCAST_PULSE_SOCKET`.

#### Modo DJ

«Modo DJ», en Música, pone canciones al azar de toda la biblioteca, o de los artistas que elijas, y
cada pocas canciones (de 1 a 8) un locutor dice qué ha sonado y qué viene, en español o en inglés.
Suena donde suene la música: en este dispositivo o en Snapcast. La cola se rellena sola cuando
quedan pocas canciones. Lo que dice el locutor entra en la cola como una canción más, y se prepara
mientras suena la anterior: si no llega a tiempo, esa vez no habla, pero nunca hay silencio
esperándolo. «DJ ✕», en la barra, sale del modo DJ y deja sonar lo que haya en la cola. Poner otra
cosa también sale. Las cuentas infantiles no lo tienen.

El texto lo escribe la IA de OpenRouter (el modelo de la voz, en Ajustes) solo con lo que dicen los
ficheros: título, artista y álbum. Cuesta unos 0,0001 $ por locución. Sin clave, dice una frase fija.

Con la clave de OpenRouter, la voz también es de OpenRouter: Gemini 3.8 Flash TTS, de hombre (Puck)
o de mujer (Laomedeia), a elegir en el diálogo del modo DJ. Dice bien los nombres y títulos en
inglés dentro de una frase en español, y cuesta alrededor de medio céntimo por locución (unos 5
céntimos por hora, hablando cada 3 canciones). No hace falta instalar nada más.

Sin clave, o como plan B si OpenRouter falla, la voz es
[Piper](https://github.com/OHF-Voice/piper1-gpl), gratis y en local, con su servidor HTTP en el PC,
como Ollama:

```sh
python3 -m venv ~/piper && ~/piper/bin/pip install 'piper-tts[http]'
~/piper/bin/python -m piper.download_voices --data-dir ~/piper/voices es_ES-davefx-medium en_US-lessac-medium
```

Y como servicio de usuario de systemd, igual que el mpv del salón
(`deploy/jellycartoon-piper.service`):

```sh
mkdir -p ~/.config/systemd/user
cp deploy/jellycartoon-piper.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now jellycartoon-piper
```

Escucha en el puerto 5000, y fuera de 127.0.0.1 para que llegue el contenedor. Un servicio de
usuario arranca cuando ese usuario entra en su sesión, no al encender el PC. Para que arranque con
el PC aunque nadie entre (sirve también para el mpv del salón):

```sh
sudo loginctl enable-linger miguel   # tu usuario
```

Con un cortafuegos (ufw), el contenedor no llega al PC hasta que se le abre el puerto, solo a las
redes de Docker. Lo mismo para Ollama, con el 11434:

```sh
sudo ufw allow from 172.16.0.0/12 to any port 5000 proto tcp
```

En el `.env`:

```sh
PIPER_URL="http://host.docker.internal:5000"
```

`PIPER_VOICE_ES` y `PIPER_VOICE_EN` cambian las voces; tienen que estar en la carpeta de datos de
Piper.

#### Más voces, para la voz de la casa

Los satélites de voz (#223) contestan con la «Voz de la casa», que se elige en Ajustes → Casa entre
las voces en español instaladas con Piper (se pueden escuchar antes). Para tener donde elegir, de
hombre y de mujer, se instalan más en el PC con Piper, en su misma carpeta de datos (unos 400 MB
estas):

```sh
~/piper/bin/python -m piper.download_voices --data-dir ~/piper/voices es_ES-sharvard-medium es_ES-carlfm-x_low es_ES-mls_9972-low es_ES-mls_10246-low es_AR-daniela-high es_MX-claude-high
```

Piper las ve sin reiniciarlo. `es_ES-sharvard-medium` trae dos hablantes, uno de hombre (`M`) y otro
de mujer (`F`), y en Ajustes salen por separado. Todas las voces están en
[piper-voices](https://huggingface.co/rhasspy/piper-voices/tree/main/es). El DJ no cambia: sigue con
`PIPER_VOICE_ES`.

Debajo de la voz, «Expresividad» (de 50 a 150 %) cambia cuánto varían la entonación y el ritmo de
Piper (sus `noise_scale` y `noise_w_scale`; 100 % es como lo hace él, y muy alta puede sonar rara),
y «Velocidad» (de 70 a 130 %) lo rápido que lee (`length_scale`); por defecto, 120 % y 95 %, algo
más viva y pausada que la suya. «Volumen de la voz» la sube hasta
12 dB (con un limitador, sin que distorsione),
y «Música mientras habla» dice cuánto baja la música de Snapcast mientras suena (de −6 a −30 dB;
−12 por defecto, como en el móvil). Valen para todo lo que dicen los satélites: respuestas, frases
de espera y avisos de los temporizadores. El móvil y la tablet usan la voz del propio aparato.

Si la IA tarda más de segundo y medio en contestar, el satélite dice antes una «frase de espera»
(«Vale.», «Un momento.»…), una distinta cada vez, y la respuesta detrás. Se cambian en Ajustes →
Casa, debajo de la voz, una por línea. Piper las lee al arrancar y al cambiar la voz o las frases,
y se quedan guardadas, así que suenan al momento (por Snapcast, con su segundo de búfer). Cada una
se puede escuchar antes de guardarla y, ya guardada, grabar con una voz IA («Grabar con voz IA»:
Gemini, voz Kore, por OpenRouter; unos céntimos, una vez), más viva que Piper, con un tono a elegir
(«acento rioplatense», «villana de película»…). Se guarda en `DATA_DIR/frases-espera`; las que no
se graban, o con «Volver a Piper», las dice Piper. Al quitar una frase se borra su grabación.
«Respuestas con: Voz IA» hace que también las respuestas y los avisos los diga Kore, la misma voz
que las frases grabadas: cada respuesta tarda unos 2–3 s más (medido) y cuesta algo; si Gemini falla
o tarda más de 10 s, la dice Piper. En el Registro queda lo que tardó cada una («Voz IA: … ms»).

Los temporizadores y las alarmas de los satélites («avísame en una hora para pedir cita en la
peluquería», «despiértame de lunes a viernes a las 7:30») los lleva el servidor (#241), y se ven y
se cambian en la Agenda, en «Alarmas y temporizadores», donde también se ponen a mano: para la casa
o para alguien, y sonando en toda la casa o en un satélite. Al cumplirse suenan por donde contesta
ese satélite: dos «din-don» y su nombre dicho, y cinco segundos de silencio para que se oiga la
palabra de activación, que lo para (o «Parar» en la Agenda); si nadie lo para, se calla a los tres
minutos. Si el satélite contesta por Snapcast, lo dice el servidor; si no, el satélite, avisado por
su canal (`/api/satelite/avisos`). Las alarmas que se piden desde el móvil suenan en toda la casa.

### Juegos

Un experimento (#176): juegos retro en la Vista TV, con
[EmulatorJS](https://emulatorjs.org) (GPL-3.0) en el navegador y un mando de juego. Con
`HOST_GAMES_DIR="/ruta/a/las/roms"` en el `.env` se monta de solo lectura y aparece la tarjeta
Juegos en `/tv`; en desarrollo se usa `GAMES_DIR`.

- Una carpeta por consola, cada una con su emulador: `nes`, `snes`, `gb`, `gbc`, `gba`,
  `mastersystem` y `megadrive`. Las demás no salen. Los juegos pueden ir tal cual o en `.zip` o `.7z`.
- Las recreativas, en `arcade`, con FinalBurn Neo: sus `.zip` con el nombre corto de FBNeo
  (`sf2.zip`), mejor de un romset no fusionado (cada `.zip` con todo lo suyo) y de su versión
  1.0.0.3, la del núcleo de EmulatorJS. La BIOS que necesiten (`neogeo.zip` para Neo Geo), en la
  misma carpeta: no sale en la lista y se le pasa al juego que la usa. Los nombres completos salen
  de la lista de juegos de FBNeo, que se baja una vez de GitHub (13 MB) y se guarda en
  `HOST_DATA_DIR/juegos`.
- En `/tv/juegos`, una tarjeta por consola; dentro, sus juegos en cuadrícula, cada uno con su
  carátula.
- Las imágenes vienen de las miniaturas de
  [libretro](https://docs.libretro.com/guides/roms-playlists-thumbnails/) (las de RetroArch), sin
  cuenta: la carátula al abrir la consola, y la pantalla de título y una captura al abrir el juego.
  Se buscan por el nombre No-Intro del fichero, como `Tetris (World).zip`: con otro nombre no las
  encuentra. Se guardan en `HOST_DATA_DIR/juegos`.
- Cada juego tiene su página, con «Jugar» y lo que se sabe de él: la primera vez que se abre se
  busca en Wikidata entre los juegos de su consola (año, desarrolladora, género, modos, música) y
  se trae el resumen de la Wikipedia. Si hay dudas, la página pregunta cuál es.
- El fondo de esa página se elige en ella entre esas imágenes y la que se capture jugando:
  Play/Pausa en el mando mientras se juega la guarda y la pone de fondo, y otra pulsación la
  cambia. Sin elegir, es la pantalla de título.
- El juego ocupa toda la pantalla. Atrás en el mando a distancia lo cierra y vuelve a su página,
  e Inicio, a la Vista TV.
- OK en el mando a distancia, o Select y Start a la vez en el mando de juego, pausa el juego y abre
  su menú: Continuar, Guardar partida, Cargar partida, Reiniciar y Salir. Las partidas se guardan
  en el servidor, por persona (en `HOST_DATA_DIR/partidas`), con una imagen y la fecha; se pueden
  cargar desde cualquier dispositivo y borrar desde la lista. También salen en la página del juego,
  bajo su fondo: elegir una abre el juego en ese momento. En el menú, el mando de juego también
  sirve: la cruz, A y B.
- Lo que guarda el propio juego (la pila del cartucho: un Zelda, un Pokémon) también va al
  servidor, por persona (en `HOST_DATA_DIR/cartuchos`): cada minuto si ha cambiado y al salir del
  juego. Al empezar se juega con el de esa persona, aunque otra haya jugado antes en ese navegador.
  El que ya hubiera en el navegador antes de esto se sube como de quien juegue primero.
- Fuera de los juegos, el mando de juego sirve en toda la Vista TV como el mando a distancia: la
  cruceta (o el stick) se mueve, A es OK, B es Atrás, Start es Inicio y Select el micrófono. No
  llega a mpv: con una película o un capítulo delante, el navegador no lo lee.
- El mando de juego se reconoce por udev, y el Chromium de Flatpak no lo ve sin
  `flatpak override --user --filesystem=/run/udev:ro org.chromium.Chromium`, que pone
  `scripts/pantalla.sh`. Luego hay que cerrar Chromium y abrirlo, y pulsar un botón del mando en el
  juego: hasta entonces el navegador no lo muestra.
- Estadísticas de cada persona: cuánto ha jugado (sin contar pausas ni el menú), a qué y cuándo,
  en `/tv/juegos/estadisticas` y en la sección Juegos de la app completa; en la página de cada
  juego, el total y la última vez. Solo con «Guardar historial» activado en Ajustes.
- EmulatorJS se carga de su CDN, en la versión 4.2.3: el salón necesita internet para jugar.
- Los botones del mando de juego, a gusto de cada persona y por consola, en la sección Juegos de
  la app completa (`/juegos/mando`): sobre un dibujo del mando se toca un botón y se elige qué hace
  en los juegos de esa consola; si eso ya lo hacía otro, se intercambian. Se aplican al empezar
  cada juego, por encima de lo que se cambie en el menú de EmulatorJS. La cruceta, los sticks y
  Select + Start para el menú no cambian.
- Los shaders (cómo se ve la imagen: tele de tubo, suavizada o los píxeles tal cual), para toda la
  casa, en `/juegos/shaders`: uno para todos los juegos, otro por consola y otro por juego; manda
  el más cercano. Se aplica al empezar cada juego, por encima de lo elegido en el menú de
  EmulatorJS. El del juego también se elige jugando, en su menú (OK o Select + Start) →
  «Imagen»: al moverse por la lista se ve en el juego, A lo guarda y Atrás lo deja como estaba.
- No está para los peques.

#### Steam

Los juegos instalados en el Steam del PC de la pantalla salen en `/tv/juegos`, en la tarjeta
Steam, y se abren allí en Big Picture. Con Steam nativo (no el Flatpak), en el `.env`:

```sh
HOST_STEAM_DIR="/home/yo/.local/share/Steam"
```

y `docker compose -f compose.prod.yaml up -d`. En desarrollo, `STEAM_DIR` con esa ruta y
`STEAM_SOCKET` con el socket.

- La lista sale de los propios ficheros de Steam, de solo lectura: un `appmanifest_<appid>.acf`
  por juego instalado en `steamapps`, y las carátulas de su biblioteca en
  `appcache/librarycache`. No se monta nada más de Steam (su configuración, sus cuentas). Solo la
  biblioteca principal: los juegos de otros discos no salen.
- Proton y los Steam Linux Runtime también son «apps» instaladas, pero no tienen carátula en la
  biblioteca, y así se quedan fuera. Ubisoft Connect Services sí la tiene y sale.
- Para abrirlos, `scripts/pantalla.sh` instala en ese PC un socket de systemd del usuario
  (`deploy/jellycartoon-steam.socket`) en `HOST_DATA_DIR/steam.sock`, junto al de mpv. Por cada
  juego elegido arranca `jellycartoon-steam@.service`, que con `deploy/jellycartoon-steam.sh`
  (instalado en `~/.local/bin`) abre con `xdg-open` las direcciones de Steam
  `steam://open/bigpicture` y `steam://rungameid/<appid>`. Steam corre en su propia unidad, no en
  esta. Si Steam no estaba abierto, abre primero Big Picture y manda el juego cuando ya está
  arriba (las dos a la vez arrancan dos Steam y el juego se pierde).
- Con Big Picture delante, la Vista TV deja de leer el mando de juego: solo lo lee con el foco.
- Al salir del juego queda Big Picture en la tele; el botón de encendido del mando vuelve a la
  Vista TV.
- Cada juego listado se guarda en la tabla `steam_game` por su appid, para poder ponerle
  etiquetas más adelante (los juegos infantiles para los peques).
- No está para los peques, y el tiempo de juego no se cuenta todavía.
- Si no abre nada: `systemctl --user status jellycartoon-steam.socket` y
  `journalctl --user -u 'jellycartoon-steam@*'` en ese PC, y el Registro de la app.

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

### Modo carretera y Viajes

Están en Seilide (#253): su README, `nube/README.md`, cuenta cómo funcionan. Casa le da la música,
el Whisper de la voz, sus manos (Snapcast, temporizadores, el tiempo) y el Telegram de cada uno, por
el túnel; `/carretera` y `/viajes` de casa llevan a los de Seilide, y compartir un sitio desde
Google Maps a JellyCartoon también.

#### Bot de Telegram de la casa

Distinto del Telegram del modo carretera (la cuenta de cada uno): un **bot** de la casa (#243), con
[grammY](https://grammy.dev), que avisa en el grupo de Telegram de la familia diciendo quién hizo
qué. Se crea con @BotFather (`/newbot`) y su token se pone en Ajustes → Casa → Bot de Telegram
(cifrado); al añadirlo al grupo, la app lo detecta (si ya estaba, `/start` en el grupo) y se elige
ahí. Avisa, cada cosa activable: de lo que se apunta en la Agenda y de sus avisos, y de las
alarmas y temporizadores de la casa al sonar (los de una persona, no). La lista de la compra y la
nevera viven en Seilide (#253), que aún no avisa por Telegram. Pregunta a Telegram por lo nuevo él mismo (long polling):
no hay que abrir nada hacia fuera. Un token solo puede usarlo una instalación a la vez.

Por voz: «di en el grupo que ya está la comida» lo dice el bot en el grupo, diciendo de quién o
de dónde viene («📣 Desde el salón: …»), también desde los satélites. Y desde el móvil o la tablet
(no desde un satélite, que no sabe quién habla), con la cuenta propia conectada: «dile a Ana que
llego en diez minutos», «contesta a Ana que voy de camino» buscan el chat por cómo suena y
preguntan antes «¿Le mando a Ana: …?»; solo se envía con un «sí», en otra orden, que exige el
servidor, no la IA. Si Ana escribió hace poco, va como respuesta a su último mensaje.

### Voz

Órdenes habladas desde el móvil (#33), pensadas para personas mayores: en `/voz`, un botón grande
que se mantiene pulsado mientras se habla, como los audios de WhatsApp. También se puede escribir
la orden, para probar una frase.

Lo que se dice pasa a texto con Whisper (abajo) y de ahí a un modelo de OpenRouter, con la clave de
Ajustes y su «Modelo para la voz» (por defecto, Claude Haiku 5.5: rápido, y bueno eligiendo
herramientas). El modelo tiene las acciones de la app como herramientas: buscar en la música, poner
un artista, álbum, lista o canción (una canción, sola), poner una emisora, pausar, seguir,
siguiente, anterior, parar y el volumen de toda la casa. También «para cuando acabe esta canción»
(se apunta una vez: si antes suena otra, se olvida) y «apaga la música en media hora» (entonces
espera al final de la canción que suene; con la radio, para al momento), aquí o en toda la casa.

A Whisper se le dan como pista los artistas de la biblioteca (los que más canciones tienen, unos
600 caracteres), para que escriba bien sus nombres. Los títulos no caben, así que la búsqueda de
música, si no encuentra todas las palabras, devuelve lo que más se parece por cómo suena:
«Boyman Rhapsody» encuentra «Bohemian Rhapsody» a la primera.

- **Dónde**: aquí (el dispositivo, que lo pone en su propia barra) o toda la casa (Snapcast, si
  está), o uno solo de sus altavoces por su nombre («pon Queen en el dormitorio»): los demás se
  silencian, y «toda la casa» les quita el silencio. Sin decirlo, aquí. Un capítulo en Snapcast
  suena solo con su audio (ver Snapcast).
- **La respuesta**, una frase corta, se ve en grande y se lee en voz alta con la voz del propio
  dispositivo (`speechSynthesis`). Si duda entre pocas opciones, pregunta nombrándolas, con
  botones; si no encuentra algo, lo dice y propone lo más parecido.
- **Tras una pregunta** (con opciones, o que acaba en «?»), el micrófono se abre solo 8 s, con su
  pitido, sin decir «hola casita» ni pulsar nada, en el móvil, la tablet y los satélites: se
  contesta de palabra («la segunda», «el álbum»). Las opciones van con su orden en la conversación,
  así que la IA sabe cuál es. Si no se dice nada, se cierra y quedan los botones.
- Recuerda los últimos turnos: «no, eso no, los Pegamoides» funciona.
- Internet, si se activa en Ajustes → Casa («Buscar en internet desde la voz»): para lo que no
  sabe porque es de hoy (un resultado, una noticia, un horario), con la búsqueda web de OpenRouter
  y el modelo de la voz; solo cuando hace falta, algo más de un céntimo y unos 7 s por búsqueda
  (medido), en el Registro. Unas «Indicaciones para buscar» en texto libre dicen dónde mirar o qué
  evitar; siempre contesta corto, con el día de lo que encuentra y sin inventar.
- Su carácter, en texto libre: «Cómo es la voz de la casa» (Ajustes → Casa, para todos y los
  satélites; va en sus instrucciones) y «Cómo quieres que te hable la voz» (Ajustes → Para mí, solo
  cuando sabe quién habla; va con cada orden). Hasta 500 caracteres cada uno; cambian el tono, no
  lo que hace: sigue contestando corto y preguntando antes de mandar un mensaje.
- La biblioteca, las listas y las emisoras van en sus instrucciones, que se cachean; con Haiku 5.5,
  unos 0,0003 $ por orden y unos 2 s. El coste de cada una queda en el Registro.

Con `voz` en `COMPOSE_PROFILES` y `WHISPER_MODEL` en el `.env` arranca el servicio `whisper`: el
servidor de [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (`whisper-server`, de su imagen
oficial para Vulkan) en la GPU, en español.

- La primera vez descarga el modelo al volumen `whisper_models` (`small`, unos 490 MB). `medium`
  entiende mejor, a cambio de más memoria y más tiempo.
- Solo lo alcanza la app, por la red de Docker: no publica puertos. El audio no sale de casa.
- Convierte con ffmpeg lo que graba el navegador: WebM/Opus en Android, MP4/AAC en iPhone.
- Son dos servidores con el mismo modelo: `whisper` para la voz y `whisper-subtitulos` para los
  subtítulos automáticos. Cada uno atiende una petición a la vez, y con uno solo una orden de voz
  esperaba a que acabara un trozo de subtítulos (en el salón, hasta 20 s). Con `small`, el segundo
  ocupa cerca de 1 GB más de la memoria de la GPU.
- El de los subtítulos mide cuándo empieza cada palabra (`-dtw`, que va sin _flash attention_):
  cada frase sale justo antes de que se diga, no hasta 2 s antes como pasaba con las risas o el
  diálogo rápido (#86). El de la voz no lo necesita y va más rápido con _flash attention_.
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
 KEYBOARD_KEY_10081=prog1   # Encendido: muestra y oculta la vista TV (abajo)
```

`scripts/pantalla.sh` lo instala si el receptor está enchufado, y pide ahí la contraseña de
`sudo` de esa casa. A mano, desde el repositorio:

```sh
sudo cp deploy/70-mando-g20s.hwdb /etc/udev/hwdb.d/
sudo systemd-hwdb update && sudo udevadm trigger --sysname-match="event*"
```

Después, desenchufar y volver a enchufar el receptor (o reiniciar): con `udevadm trigger` la
página ya ve las teclas nuevas, pero KDE se queda con las que tenía el receptor al arrancar y no
toma las nuevas, como el botón de encendido. Con otro mando, sus scancodes
salen de `evtest` (con `sudo`). En la vista TV: el OK
entra en lo que tiene el foco, F7 vuelve a su portada, F8 pausa o sigue lo que suena (el mpv del
salón, o la música, la radio o el podcast del navegador) y F9 habla: un toque empieza y otro
envía, porque el mando manda su tecla pulsada y soltada a la vez, y lo que oye y contesta se ve en
grande. Con el puntero del mando (modo ratón) apagado, para que mueva el foco. El micrófono del
mando es una tarjeta de sonido USB más, y el del sistema si no hay otro.

**El botón de encendido del mando** (#159) no apaga el PC: muestra y oculta la vista TV. Sin el
hwdb llega como el de encendido del equipo (`KEY_POWER`, scan `0x10081`, por el receptor USB, la
tele no lo ve) y KDE ofrece apagar o suspender; con él es `Launch1`, y un
[script de KWin](https://develop.kde.org/docs/plasma/kwin/), `deploy/kwin/jellycartoon-mando`,
lo atrapa como atajo global. El botón del PC sigue siendo el de encendido.

- **Con otra cosa delante** (Steam, un juego, el escritorio): trae la vista TV. Si no está
  abierta, la abre: `jellycartoon-tv.service`, que lanza «JellyCartoon (tele)»
  (`~/.local/share/applications/jellycartoon-tv.desktop`, Chromium en modo app con la dirección
  de `ORIGIN` y `/tv`).
- **Con la vista TV delante**: la aparta y vuelve lo que había antes.
- **Con un vídeo en mpv delante**: lo pausa y trae la vista TV; otra vez, vuelve el vídeo y sigue.
  Si desde la vista TV se le da a Play/Pausa o se manda otra película, el vídeo vuelve delante.
- La vista TV es la ventana de Chromium sin barra de direcciones cuyo título acaba en
  «JellyCartoon», como el de todas las páginas de la app; el lanzador de depurar también vale.
- mpv se pausa cuando deja de estar delante (`focused`, en `mando.lua`: en Wayland no sabe si lo
  han minimizado) y sigue al volver. Para volver delante él solo, `mando.lua` llama por D-Bus al
  otro atajo del script, «JellyCartoon: el vídeo delante», que no tiene tecla.
- Los dos atajos se ven en Preferencias del sistema → Atajos → KWin, y el script en Gestión de
  ventanas → Scripts de KWin. Lo instala `scripts/pantalla.sh`, solo con KDE. A mano, desde el
  repositorio:

```sh
cp -r deploy/kwin/jellycartoon-mando ~/.local/share/kwin/scripts/
kwriteconfig6 --file kwinrc --group Plugins --key jellycartoon-mandoEnabled true
qdbus6 org.kde.KWin /KWin reconfigure
```

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
| Encendido       | Pausa y trae la vista TV; otra vez, vuelve el vídeo y sigue     |
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

### Etiquetas de los capítulos

Un modelo de visión en [Ollama](https://ollama.com) mira un fotograma cada `LABEL_EVERY_SEC`
segundos (15 por defecto) del capítulo convertido y dice cuáles de las etiquetas de un **conjunto**
se ven en él. Los conjuntos (con nombre: «Animales», «Lugares»…) se hacen en Ajustes → Casa. Se pide
en una serie: «Seleccionar capítulos», elegirlos y «Etiquetar con» un conjunto. Van a una cola, de
uno en uno y en segundo plano, que se sigue en Gestión → Etiquetado: lo que se está haciendo, lo que
espera, lo fallido (para reintentarlo) y lo último hecho, con lo que vio. Luego la serie se filtra
por etiqueta, y en cada capítulo salen las suyas (al pasar por encima, el conjunto y en cuántos
fotogramas). Etiquetar otra vez con un conjunto sustituye solo lo de ese conjunto; borrar un
conjunto quita lo que vio con él. Estas etiquetas son aparte de las de la serie (las que se ponen a
mano, como «infantil»), y las cuentas infantiles no las ven.

En el `.env`, con Ollama en el mismo PC que la app en Docker. Ni `localhost` ni `127.0.0.1`:
dentro del contenedor son el propio contenedor. `host.docker.internal` es el PC (está en
`extra_hosts` de `compose.prod.yaml`), aunque cambie su IP:

```sh
OLLAMA_URL="http://host.docker.internal:11434"
LABEL_MODEL="qwen2.5vl:7b"   # el de por defecto; antes: ollama pull qwen2.5vl:7b
```

Ollama, por defecto, solo escucha en `127.0.0.1`, y el contenedor no llega. Con el servicio de
systemd de su instalador:

```sh
sudo systemctl edit ollama
```

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
```

```sh
sudo systemctl restart ollama
```

Ollama no tiene contraseña: así lo puede usar cualquiera de la red de casa. Si importa, en el cortafuegos se cierra el puerto 11434 menos para las redes de
Docker (`172.16.0.0/12`). Con ufw, que por defecto lo cierra todo, eso es abrirlo solo para ellas:
`sudo ufw allow from 172.16.0.0/12 to any port 11434 proto tcp`.

La respuesta usa las [salidas estructuradas](https://docs.ollama.com/capabilities/structured-outputs)
de Ollama: para cada etiqueta, un sí o un no. Pidiéndole en cambio cuáles de la lista se veían,
`qwen2.5vl:3b` elegía alguna aunque no estuviera (un perro en 4 fotogramas de 5 sin perros).

El de por defecto es `qwen2.5vl:7b` (unos 6 GB; cabe entero en una gráfica de 8 GB como la RX 7600 del
salón): unos 1,3 s por fotograma, un capítulo de 22 minutos en unos 2 minutos. El de 3B va el doble de
rápido, pero con algunas imágenes entra en bucle (un bosque de noche en Scooby-Doo) y Ollama lo corta.
Si el modelo no puede con un fotograma, se reintenta una vez cargándolo de nuevo y, si sigue sin
poder, ese fotograma queda fuera (un aviso en el Registro); el capítulo solo falla si quedan fuera
más de la cuarta parte.

## Privacidad

Lo que sale de casa hacia la IA de OpenRouter, cuando hay clave, y lo que no:

- **Gastos** (tickets y facturas) vive en Seilide (#253): lo que se manda allí a la IA y lo que se
  guarda está en el README de `nube/`. Desde casa solo va la foto del ticket de la gasolina (modo
  carretera), y se lee allí.

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
2. **R2 → Manage API tokens → Create API token**, con el permiso **Object Read & Write** y solo
   **ese bucket**. Apunta el _Access Key ID_, el _Secret Access Key_ y el _Account ID_.
3. **En el bucket, Settings → Bucket lock rules** ([bloqueo](https://developers.cloudflare.com/r2/buckets/bucket-locks/)):
   una regla de 5 días para el prefijo `backups/`. Como el token también puede borrar, así nadie que
   lo tenga borra las copias recientes.

Cada bucket, de una sola casa: una clave de R2 vale para el bucket entero, y con uno compartido una
casa podría borrar las copias de otra. Tras cada copia se borran las de antes de las 7 últimas noches
(`BACKUP_KEEP`): por número y no por fecha, para que si las copias dejan de subir no se vayan también
las últimas buenas.

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
# BACKUP_KEEP="7"                   # cuántas noches se guardan
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

1. **PR de `development` a `main`**, y merge. Solo se puede con el CI en verde (`.github/workflows/ci.yml`:
   Prettier, `svelte-check`, tests, build y que no falte ninguna migración); también corre en cada
   push a `development`.
2. **Un release en GitHub sobre `main`**, con la versión como `vX.Y.Z` (tres números): _patch_ para
   arreglos, _minor_ para novedades, _major_ si algo deja de funcionar como antes. Las notas, en
   español: son las que ve el administrador en el aviso de la app. No lo marques como _pre-release_,
   o no mueve `stable`. Desde la web (Releases → Draft a new release) o con:

   ```sh
   gh release create v1.2.0 --target main --title "1.2.0" --notes "…"
   ```

3. **Espera a que Actions construya las imágenes** (unos minutos). Desde ahí, WUD las instala esa
   madrugada, o el administrador con «Actualizar ahora». Cuando terminan (o fallan) llega un aviso a
   Slack, por el _Incoming Webhook_ del secreto `SLACK_WEBHOOK_URL` del repositorio.

WUD actualiza las imágenes, nunca `compose.prod.yaml` ni el `.env`. Si un cambio necesita tocarlos,
dilo en las notas («requiere actualizar el compose»): en cada casa hay que traer el compose nuevo
(`git pull`), completar el `.env` y hacer `pull` y `up -d`.

Una imagen nueva (como lo fue `-backup`) puede quedar privada en GitHub la primera vez. Si `pull`
dice _denied_, en GitHub: Packages → la imagen → Package settings → Change visibility → Public.

## Licencia

[AGPL-3.0-or-later](LICENSE), para todo el repositorio: la casa, `nube/` (Seilide), `packages/` y
`satellite/`. Se puede usar, cambiar y compartir, también con fines comerciales; quien ofrezca una
versión modificada a otros, también por la red (un Seilide propio), tiene que publicar su código.

## Pendiente

- Control remoto (dispositivos + comandos play/pause/seek por SSE).
- Subtítulos de imagen (VobSub/PGS): OCR.
- Telecine inverso para DVD de dibujos rodados en película.
- Metadatos/pósters (TMDB) y edición manual de títulos.
