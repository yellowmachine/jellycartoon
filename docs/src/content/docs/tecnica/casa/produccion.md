---
title: 'Producción'
---

Usa las imágenes que construye GitHub Actions (`ghcr.io/yellowmachine/jellycartoon`, `-caddy` y
`-backup`), en dos canales:

- **`stable`**, el que se usa por defecto: la última versión publicada. Cada _release_ de GitHub
  (`v1.2.0`) construye `1.2.0`, `1.2` y `stable`, con sus novedades en las notas del release.
- **`latest`**: cada push a `main`, para probar cambios. Se elige con `IMAGE_TAG=latest` en el `.env`.

## Instalar

En un PC con Linux y Docker (x86_64), en una terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/yellowmachine/jellycartoon/main/install.sh | sh
```

`install.sh` lo deja todo en `~/jellycartoon`: descarga `compose.prod.yaml`, pregunta cómo se llega
(con el nombre del PC o con un dominio en Cloudflare, ver [Solo en casa](/tecnica/casa/solo-en-casa/)), la
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
  [Las APIs desde fuera](/tecnica/casa/rathole/).
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
