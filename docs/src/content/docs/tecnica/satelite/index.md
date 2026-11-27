---
title: 'Satélite de voz'
description: 'Una Raspberry con micrófono y altavoz en una habitación, que habla con Seilide.'
---

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
2. En la Raspberry, una carpeta con `compose.prod.yaml`, `actualizar.sh`, `cosign.pub` y
   `.env.example` de aquí. El último, copiado como `.env`, con esas dos líneas rellenas.
3. El micrófono y el altavoz, por su nombre en ALSA: `arecord -L` y `aplay -L` (por ejemplo
   `plughw:CARD=Microphone` y `plughw:CARD=Headphones`), en `MIC` y `SPEAKER`.
4. `./actualizar.sh --instalar`: comprueba la firma de la última versión, la pone y deja la
   actualización de cada noche en el crontab. Para ver que oye:
   `docker compose -f compose.prod.yaml logs -f satellite` («Escuchando «Alexa» en …»).

En un PC los nombres de ALSA son otros (el audio integrado suele ser `plughw:CARD=PCH`). Si
tiene escritorio, su PulseAudio o PipeWire puede tener la tarjeta cogida y el satélite no oír ni
sonar: mejor sin sesión gráfica, o con el audio del escritorio apagado. Sin probar aún.

## Las actualizaciones, firmadas

Se actualiza solo cada noche a las 4:30 con `actualizar.sh`, desde el crontab (#643, fase 4), y
solo con imágenes firmadas con la clave de la familia. Así, alguien que entrara en la cuenta de
GitHub podría publicar una imagen, pero no firmarla, y el satélite no la instalaría.

- La imagen se firma con [cosign](https://github.com/sigstore/cosign) y una clave que solo está en
  el PC de quien publica, nunca en GitHub (`scripts/firmar-satelite.sh vX.Y.Z`, después de que acabe
  la Action de la versión). Sin el registro de transparencia: lo que protege es la clave, y el
  satélite la comprueba sin depender de ningún servicio de Sigstore.
- El satélite comprueba la firma con su `cosign.pub`, copiado al instalarlo y nunca bajado otra vez
  (una clave bajada de GitHub podría ser la del atacante). Fija la imagen por su digest en
  `SATELLITE_IMAGE`, en el `.env`, y nunca pone una versión más antigua que la que tiene.
- cosign corre con su propia imagen, fijada por digest en `actualizar.sh`.
- Lo que hace queda en `actualizar.log`, junto al script. Para actualizar ya: `./actualizar.sh`.

Una versión que salió sin firmar no se instala nunca: se queda en la anterior hasta la siguiente
firmada.

### La clave de firmar

La privada, `cosign.key`, nunca va al repositorio; la pública, `satellite/cosign.pub`, sí.

- **Crearla, una sola vez**, en una terminal normal (pide la contraseña dos veces):

  ```sh
  mkdir -p ~/.config/seilide && cd ~/.config/seilide && docker run --rm -it --user "$(id -u)" \
    -v "$PWD:/w" -w /w ghcr.io/sigstore/cosign/cosign:v3.1.6 generate-key-pair
  ```

  Deja `cosign.key` y `cosign.pub` en `~/.config/seilide`. El `cosign.pub` se copia a
  `satellite/cosign.pub` y a cada satélite.

- **Guardarla:** la contraseña en el gestor de contraseñas, y una copia de `cosign.key` en otro
  sitio distinto. El fichero va cifrado con la contraseña: juntos, quien entre en ese sitio tiene
  las dos cosas. La contraseña sola no sirve sin el fichero.
- **Firmar desde otra máquina** (un clon nuevo del repositorio) necesita:
  - `cosign.key` en `~/.config/seilide/`, o en otra ruta con `COSIGN_KEY=/ruta/cosign.key`;
  - su contraseña;
  - `gh` con sesión y permiso de paquetes: `gh auth login` y luego
    `gh auth refresh -h github.com -s write:packages`;
  - Docker y `jq`.

  El script comprueba que la clave es la de `satellite/cosign.pub` antes de firmar. Cada máquina con
  la clave es un sitio más de donde robarla: mejor solo una, y la copia.

- **Si se pierde** (o se teme que la tiene otro): se crea otra y su `cosign.pub` va al repositorio y
  a cada satélite, a mano por ssh, junto a su `actualizar.sh`. Mientras tanto, los satélites siguen
  con su versión; solo dejan de actualizarse.

## Los ajustes del `.env`

| Variable                   | Por defecto         | Para qué                                                                                                                                                                                                                   |
| -------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERVER_URL`               | (obligatoria)       | La dirección de Seilide, la que enseña al darlo de alta.                                                                                                                                                                   |
| `SATELLITE_KEY`            | (obligatoria)       | Su clave, también de ahí. Sin ellas dos el compose no se levanta.                                                                                                                                                          |
| `MIC`                      | `default`           | El micrófono, por su nombre en ALSA (`arecord -L`).                                                                                                                                                                        |
| `MIC_RATE`, `MIC_CHANNELS` | `48000`, `2`        | Lo que da el micrófono tal cual (`/proc/asound/cardN/stream0`), para que ALSA no tenga que convertir. Un micrófono de un canal: `MIC_CHANNELS=1`.                                                                          |
| `SPEAKER`                  | (el de por defecto) | El altavoz, por su nombre en ALSA (`aplay -L`).                                                                                                                                                                            |
| `SNAPCLIENT_SOUNDCARD`     | (el de `SPEAKER`)   | Otro altavoz para la música de la casa.                                                                                                                                                                                    |
| `WAKE_WORD`                | `hola_casita`       | Su palabra, hasta que la familia elija una en Seilide: `hola_casita`, `alexa`, `okapi`, `ocarina`, `kusanagi`, `makoto`, `oye_alizee` o `bonjour_alizee`.                                                                  |
| `WAKE_THRESHOLD`           | `0.3`               | Cuánto tiene que parecerse lo que oye a la palabra (0 a 1). Más bajo, la oye mejor, pero también se despierta más sin que se la digan.                                                                                     |
| `WAKE_MARGIN_DB`           | `15`                | Cuánto más fuerte que el ruido de fondo tiene que ser la voz para contar como que se habla, como el «Margen» del móvil.                                                                                                    |
| `WAKE_SILENCE_MS`          | `800`               | Cuánto silencio, en milisegundos, da la orden por acabada. Más corto contesta antes, pero corta a quien hace una pausa.                                                                                                    |
| `WAKE_EARLY_MS`            | `300`               | Con este silencio manda ya lo dicho a oír, sin esperar al final, y contesta antes; `0`, no.                                                                                                                                |
| `BARGE_IN`                 | `0`                 | `1`: también oye la palabra mientras piensa o contesta, y le corta para oír la nueva orden (#373). Solo con un micrófono que cancele el eco (un reSpeaker XVF3800, con el altavoz en su salida): si no, se oye a sí mismo. |
| `PLUG_PORT`                | `8790`              | El puerto donde se conectan los enchufes Shelly ([por el satélite](#los-enchufes-por-el-satélite)). En la red de casa; no se publica fuera.                                                                                |
| `ALTA_CLAVE`               | (vacía)             | Opcional: con ella, su página `/alta` abre el alta de aparatos, como «añade un aparato». Solo en el satélite, nunca en Seilide.                                                                                            |
| `TZ`                       | `Europe/Madrid`     | Su hora.                                                                                                                                                                                                                   |
| `COMPOSE_PROFILES`         | (vacío)             | `dns` en uno solo de los satélites: el [DNS de la casa](#el-dns-de-la-casa-adguard-home).                                                                                                                                  |

«Por defecto» es lo que pone el compose si la variable falta; el `.env.example` que se copia al
instalar ya trae `WAKE_WORD="alexa"` y `WAKE_THRESHOLD="0.5"`. Cambiar el `.env` necesita
`docker compose -f compose.prod.yaml up -d` para que valga.

## La palabra que lo despierta

Cada satélite empieza con la de su `WAKE_WORD`. Si la familia elige una en Seilide (Ajustes →
Familia → «Palabra que los despierta»), esa vale para todos, y para los móviles y tablets en
Carretera y Cocina. Los satélites cambian en unos segundos, sin reiniciar, y la recuerdan aunque
arranquen sin conexión. Si dos aparatos oyen la misma orden, Seilide solo hace la primera en llegar
(`order-twins.ts`), salvo en Carretera y en lo que llega por la app de casa. `WAKE_THRESHOLD` sigue siendo de cada
satélite, porque depende de su micrófono y de su habitación.

## En qué idioma se le habla

Cada satélite tiene sus idiomas en **Ajustes → Familia → «Satélites de voz» → Le hablan en**:
español, inglés o francés (#647). Con uno solo, el reconocimiento (el Whisper de la casa, también
directo, o OpenRouter) oye en ese idioma, y contesta en él. Con varios, el reconocimiento adivina
cuál es, y **Contesta en** elige: uno de ellos o «Como le hablen». Una orden corta puede salir en el
idioma que no es, así que con uno solo oye mejor. Lo cambia al momento, sin tocar la Raspberry. La
palabra que lo despierta es la misma en cualquier idioma.

Por ahora, en inglés o francés no dice las frases de relleno mientras piensa, y lo que dice por su
cuenta (sin clave, sin saldo, los avisos) sigue en español. La voz es la de la familia: «Cómo habla»
con un acento de aquí lo lleva también al otro idioma.

## Con la música de la casa (Snapcast)

Para que la música de jellycartoon suene también en esta habitación, el satélite lleva su propio
cliente de Snapcast: basta poner la IP del snapserver de la casa (con su puerto si no es 1704) en
Seilide, junto al satélite, en **Ajustes → Familia → «Satélites de voz» → Música (snapserver)**.
Se le dice al momento, sin tocar la Raspberry; vacío, sin música.

Suena por el mismo altavoz que la voz (`SPEAKER`), o por otro con `SNAPCLIENT_SOUNDCARD`. Si
la Raspberry tenía el `snapclient` de Debian, se quita, para que no suene dos veces:
`sudo systemctl disable --now snapclient`.

## Los enchufes, por el satélite

Los enchufes Shelly no se conectan a Seilide, sino al satélite (#643): su WebSocket de salida apunta
a `ws://<IP-del-satélite>:8790/enchufe/<su-clave>`. El satélite abre otro a Seilide por cada enchufe:
lo que dice el enchufe sube tal cual, y de lo que Seilide le pide al enchufe solo baja una lista
cerrada (`satellite/src/relay.ts`):

- leer: `Shelly.GetDeviceInfo`, `Wifi.GetStatus`, `Switch.GetStatus`, `Sys.GetConfig`, `Schedule.List`;
- encender y apagar: `Switch.Set`, con temporizador de hasta un día;
- sus horarios: `Schedule.Create` solo con `Switch.Set` dentro, y `Schedule.Delete`;
- su zona horaria (`Sys.SetConfig` con `location.tz` y nada más);
- dejar de conectarse al quitarlo (`Ws.SetConfig` con `enable: false`) y reiniciarse.

Lo demás (scripts, configuración, otra dirección, contraseña, actualizaciones) no baja: el satélite
contesta a Seilide con un error 403 y lo anota en su registro. Así, si alguien entrara en Seilide,
podría encender y apagar, pero no meter un script en el enchufe ni llevárselo a otro servidor.
Shelly no pide contraseña en su WebSocket de salida, por eso la lista es lo que lo protege.

El satélite también lee los vatios que suben (#651): con la misma cuenta que Seilide
(`comun/plug-watch.ts`), sabe cuándo empieza y acaba un ciclo de cada enchufe («cuando acabe la
lavadora»), y lo anota en su registro. Es el primer paso para que cumpla él las reglas de enchufes,
también sin internet.

Al darlo de alta (**Enchufes → Buscar enchufes → Añadir**), el satélite le pone también una
contraseña suya, para que nadie más en la wifi lo cambie desde su página. Se guarda solo en el
satélite (`/data/enchufes.json`, en su volumen) y no se manda a Seilide. Los enchufes que ya iban
directos a Seilide lo dicen en su tarjeta, con **Pasar al satélite**. Con un satélite en la familia,
no hay forma de añadir un enchufe a mano, directo a Seilide.

### Órdenes firmadas por aparato (fase 2)

Lo que cambia un enchufe (encender, apagar, el temporizador, los horarios, la hora) necesita además
la firma de un aparato dado de alta en el satélite. Sin firma, solo baja en los enchufes con el
permiso **«Seilide puede hacerlo solo»** (horarios, reglas, voz, pausa), que también se cambia con
una orden firmada. Leer el estado baja siempre. Además, como mucho 30 órdenes por minuto y enchufe.

- **El aparato**: el navegador crea su par de claves ECDSA P-256 con WebCrypto, con la privada no
  exportable, en su IndexedDB (`seilide-enchufes`). Cada orden es un JSON con el satélite, el
  aparato, el enchufe (su id de Shelly), el método, sus parámetros, la hora y un nonce. El aparato
  la firma y Seilide la pasa tal cual (`Satelite.Firmada`). El satélite comprueba la firma, que sea
  para él y para ese enchufe, que tenga menos de 2 minutos y que no la haya visto antes. Luego
  aplica la misma lista de siempre.
- **El alta**: «añade un aparato», dicho al satélite (solo vale si acaba de oír él mismo una orden),
  o la `ALTA_CLAVE` en su página, abre el alta 5 minutos. En el móvil, dentro de la wifi, se abre
  `http://<IP-del-satélite>:8790/alta`, se copia el código y se pega en **Enchufes → Este aparato**.
  El código no sale del móvil. A Seilide solo va la clave pública con un HMAC hecho con el código.
  El satélite contesta firmado, y el móvil comprueba esa firma con la huella que va en el código.
- **Los horarios y la pausa**, sin el permiso: al cambiarlos en Enchufes, Seilide le dice al aparato
  qué tiene que hacer el enchufe (apagarlo por la pausa o encenderlo durante el calentón, y su lista
  de horarios). El aparato lo firma (`Satelite.Horarios`) y el satélite lo hace todo seguido: borra
  los horarios suyos o de Seilide que solo encienden o apagan, y crea los nuevos. Lo que Seilide hace
  solo a su hora (acabar el calentón, el fin de «que no se encienda esta tarde»), las reglas y la
  voz siguen necesitando el permiso. Al configurar un enchufe, el satélite le pone también la zona
  horaria de su `TZ`.
- **Lo que guarda el satélite** (`/data/seguridad.json`): su propia clave, los aparatos y los
  permisos. La página `/alta` los lista. Desde su página, quitar un aparato solo se puede con el
  alta abierta. El propio aparato también puede irse, con «Quitar este aparato del satélite» en
  Enchufes: firma `Satelite.Olvidar` (sin enchufe) y el satélite solo quita al que lo firma.
- **Cada código, un aparato**: el alta se cierra al usarla, o a los cinco minutos. Para otro, se
  vuelve a pedir. La página de Enchufes enlaza la del satélite, que manda su dirección con el latido.

Lo que no cubre: el JavaScript de la app lo sirve Seilide. Un Seilide hackeado podría servir uno que
firme órdenes con la clave del aparato mientras la app está abierta. Por eso los límites los pone
el satélite, y no el aparato.

El satélite tiene que estar en la misma red que los enchufes. Conviene darle una IP fija (una reserva
en el router), porque los enchufes guardan esa IP.

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

Nada lo actualiza solo: una versión nueva de AdGuard se cambia a mano en `compose.prod.yaml`, para que
una actualización de noche no deje la casa sin DNS.

## Mientras se desarrolla

`compose.yaml` lo construye desde este repositorio en la propia Raspberry, desde el PC:

```sh
DOCKER_HOST=ssh://clientpi.local docker compose -f satellite/compose.yaml up --build -d
```
