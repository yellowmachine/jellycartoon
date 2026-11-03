---
title: 'Snapcast'
---

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
  (`module-pipe-sink`), y mezcla encima lo que dice la casa: sus avisos (más abajo).
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

La casa dice por Snapcast sus avisos (los temporizadores y las alarmas que suenan en toda la casa,
más abajo): encima de la música, que baja (−12 dB, como en el móvil) mientras habla, con un segundo
de retraso, el del búfer. Lo mezcla el PulseAudio (`deploy/pulse.pa`; Snapcast solo cambia de
fuente, no mezcla). Después de actualizar, termina con
`docker compose -f compose.prod.yaml up -d`: hay un servicio, `pulseaudio`, y la app necesita
`SNAPCAST_PULSE_SOCKET`. La segunda fuente de snapserver, `Voz` (`HOST_DATA_DIR/snapvoz`), era para
que los satélites de la casa contestasen en un solo altavoz; los satélites son de Seilide (#329) y
la app ya no la usa.
