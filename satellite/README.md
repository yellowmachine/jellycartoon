# Satélite de voz

Una Raspberry (o un PC) con micrófono y altavoz en una habitación: oye la palabra («Alexa» u
«hola casita»), manda la orden a Seilide y contesta con la voz de la familia. Funciona sin
jellycartoon (temporizadores, alarmas, agenda, nevera, lo que recuerda, preguntas); con
jellycartoon, además, la música, la radio y los altavoces de la casa (#296).

## Lo que hace falta

- Una Raspberry Pi 4 o 5 con **Raspberry Pi OS de 64 bits** (o Debian), o un PC con Linux.
- Un micrófono USB y un altavoz (el de la salida de auriculares vale).
- Docker, instalado como dice su documentación:
  https://docs.docker.com/engine/install/debian/ (en la Raspberry, la de Debian).

## Instalarlo

1. En Seilide, **Ajustes → Familia → «Satélites de voz» → Añadir**, con el nombre de la
   habitación. Enseña su `SERVER_URL` y su clave una sola vez: cópialas.
2. En la Raspberry, una carpeta con `compose.prod.yaml` y `.env.example` de aquí, y el segundo
   copiado como `.env`, con esas dos líneas rellenas.
3. El micrófono y el altavoz, por su nombre en ALSA: `arecord -L` y `aplay -L` (por ejemplo
   `plughw:CARD=Microphone` y `plughw:CARD=Headphones`), en `MIC` y `SPEAKER`.
4. `docker compose -f compose.prod.yaml up -d`, y para ver que oye:
   `docker compose -f compose.prod.yaml logs -f satellite` («Escuchando «Alexa» en …»).

Se actualiza solo: WUD mira cada noche (a las 4:30, `UPDATE_CRON`) si hay versión nueva, y la pone.

## Con la música de la casa (Snapcast)

Para que la música de jellycartoon suene también en esta habitación, el cliente de Snapcast del
propio Debian, fuera de Docker:

```sh
sudo apt install snapclient
```

y en `/etc/default/snapclient` la dirección de la casa y el altavoz, por ejemplo
`SNAPCLIENT_OPTS="--host 192.168.1.20 --soundcard hw:2,0"` (`snapclient --list` los enseña);
luego `sudo systemctl restart snapclient`.

## Mientras se desarrolla

`compose.yaml` lo construye desde este repositorio en la propia Raspberry, desde el PC:

```sh
DOCKER_HOST=ssh://clientpi.local docker compose -f satellite/compose.yaml up --build -d
```
