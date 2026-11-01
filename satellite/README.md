# Satélite de voz

Una Raspberry (o un PC) con micrófono y altavoz en una habitación: oye la palabra («Alexa» u
«hola casita»), manda la orden a Seilide y contesta con la voz de la familia. Funciona sin
jellycartoon (temporizadores, alarmas, agenda, nevera, lo que recuerda, preguntas); con
jellycartoon, además, la música, la radio y los altavoces de la casa (#296).

## Lo que hace falta

- Una Raspberry Pi 4 o 5 con **Raspberry Pi OS de 64 bits** (o Debian), o un PC con Linux
  (un mini PC, un portátil viejo): la imagen es para las dos (arm64 y amd64), y Docker baja la
  que toca.
- Un micrófono USB y un altavoz (el de la salida de auriculares vale); en un portátil, los suyos.
- Docker, instalado como dice su documentación para ese sistema:
  https://docs.docker.com/engine/install/ (en la Raspberry, la de Debian).

## Instalarlo

1. En Seilide, **Ajustes → Familia → «Satélites de voz» → Añadir**, con el nombre de la
   habitación. Enseña su `SERVER_URL` y su clave una sola vez: cópialas.
2. En la Raspberry, una carpeta con `compose.prod.yaml` y `.env.example` de aquí, y el segundo
   copiado como `.env`, con esas dos líneas rellenas, y `WUD_PASSWORD` con una contraseña nueva
   (`openssl rand -hex 16`): sin ella WUD no arranca (desde su 9.6 pide un administrador), y el
   compose no se levanta.
3. El micrófono y el altavoz, por su nombre en ALSA: `arecord -L` y `aplay -L` (por ejemplo
   `plughw:CARD=Microphone` y `plughw:CARD=Headphones`), en `MIC` y `SPEAKER`.
4. `docker compose -f compose.prod.yaml up -d`, y para ver que oye:
   `docker compose -f compose.prod.yaml logs -f satellite` («Escuchando «Alexa» en …»).

En un PC los nombres de ALSA son otros (el audio integrado suele ser `plughw:CARD=PCH`). Si
tiene escritorio, su PulseAudio o PipeWire puede tener la tarjeta cogida y el satélite no oír ni
sonar: mejor sin sesión gráfica, o con el audio del escritorio apagado. Sin probar aún.

Se actualiza solo: WUD mira cada noche (a las 4:30, `UPDATE_CRON`) si hay versión nueva, y la pone.

## Con la música de la casa (Snapcast)

Para que la música de jellycartoon suene también en esta habitación, el satélite lleva su propio
cliente de Snapcast: basta poner la IP del snapserver de la casa (con su puerto si no es 1704) en
Seilide, junto al satélite, en **Ajustes → Familia → «Satélites de voz» → Música (snapserver)**.
Se le dice al momento, sin tocar la Raspberry; vacío, sin música.

Suena por el mismo altavoz que la voz (`SPEAKER`), o por otro con `SNAPCLIENT_SOUNDCARD`. Si
la Raspberry tenía el `snapclient` de Debian, se quita, para que no suene dos veces:
`sudo systemctl disable --now snapclient`.

## El DNS de la casa (AdGuard Home)

Opcional, y solo en **uno** de los satélites (#355): que esa Raspberry, siempre encendida, sea el
DNS primario de la casa, con el PC del salón de secundario. Así apagar o actualizar el salón no
deja a nadie sin internet, y el nombre de la casa se resuelve dentro a la IP del salón.

1. IP fija para la Raspberry: una reserva en el router.
2. Que nada use ya el puerto 53 en ella: `sudo ss -lntup 'sport = :53'` no tiene que dar nada.
3. En su `.env`, `COMPOSE_PROFILES="dns"`, y `docker compose -f compose.prod.yaml up -d`.
4. `http://<IP-de-la-Raspberry>:3000`: el asistente de AdGuard. En él, deja la web en el
   puerto **3000** (el único publicado) y el DNS en el 53.
5. **Filtros → Reescrituras DNS**: el nombre de la casa (el de `ORIGIN`, sin `https://`) → la IP
   del salón. La misma regla que en el DNS del salón, si lo tiene: los dos tienen que contestar
   lo mismo, porque los aparatos preguntan a uno u otro.
6. Comprobar desde otro equipo, antes de tocar el router:
   `nslookup <nombre-de-la-casa> <IP-de-la-Raspberry>` (la IP del salón) y
   `nslookup google.com <IP-de-la-Raspberry>`.
7. En el router, el DHCP: DNS primario la Raspberry, secundario el salón. Los aparatos lo cogen
   al renovar la IP (apagar y encender el wifi lo adelanta).

WUD no lo actualiza: una versión nueva de AdGuard se cambia a mano en `compose.prod.yaml`, para que
una actualización de noche no deje la casa sin DNS.

## Mientras se desarrolla

`compose.yaml` lo construye desde este repositorio en la propia Raspberry, desde el PC:

```sh
DOCKER_HOST=ssh://clientpi.local docker compose -f satellite/compose.yaml up --build -d
```
