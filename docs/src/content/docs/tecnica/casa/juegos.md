---
title: 'Juegos'
---

Un experimento (#176): juegos retro en la Vista TV, con
[EmulatorJS](https://emulatorjs.org) (GPL-3.0) en el navegador y un mando de juego. Con
`HOST_GAMES_DIR="/ruta/a/las/roms"` en el `.env` se monta de solo lectura y aparece la tarjeta
Juegos en `/tv`; en desarrollo se usa `GAMES_DIR`. También se pueden abrir en
[RetroDECK](#retrodeck), en el PC de la pantalla.
`install.sh` lo pregunta. En una Raspberry conectada a la tele, sin PC: ver
[Una sola Raspberry](/tecnica/casa/raspberry/).

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

## Steam

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
- El primer recuadro, «Big Picture», abre solo Big Picture, sin juego, para la biblioteca y la
  tienda de Steam: el socket recibe `bigpicture` en vez de un appid. Tras cambiar el script, vuelve
  a pasar `scripts/pantalla.sh`.
- Con Big Picture delante, la Vista TV deja de leer el mando de juego: solo lo lee con el foco.
- Al salir del juego queda Big Picture en la tele; el botón de encendido del mando vuelve a la
  Vista TV.
- Cada juego listado se guarda en la tabla `steam_game` por su appid, para poder ponerle
  etiquetas más adelante (los juegos infantiles para los peques).
- No está para los peques, y el tiempo de juego no se cuenta todavía.
- Si no abre nada: `systemctl --user status jellycartoon-steam.socket` y
  `journalctl --user -u 'jellycartoon-steam@*'` en ese PC, y el Registro de la app.

## RetroDECK

Los juegos de `HOST_GAMES_DIR` también se pueden jugar en
[RetroDECK](https://retrodeck.net) en el PC de la pantalla, en vez de en el navegador: con su
Flatpak (`net.retrodeck.retrodeck`) instalado allí, la página de cada juego tiene
«Jugar en RetroDECK», y `/tv/juegos`, una tarjeta RetroDECK al final que lo abre sin juego, con
su propio menú (ES-DE).

- Para abrirlos, `scripts/pantalla.sh` instala en ese PC un socket de systemd del usuario
  (`deploy/jellycartoon-retrodeck.socket`) en `HOST_DATA_DIR/retrodeck.sock`, junto al de Steam,
  y `jellycartoon-retrodeck@.service`, con la carpeta de las ROMs (la que la app monta en
  `/games`). Solo si RetroDECK está instalado y hay `HOST_GAMES_DIR`. La app ofrece el botón y la
  tarjeta solo mientras está el socket. En desarrollo, `RETRODECK_SOCKET` con el socket.
- La app manda la carpeta de la consola y el fichero (`snes/Tetris (World).sfc`), o `retrodeck`
  para la tarjeta, y `deploy/jellycartoon-retrodeck.sh` (en `~/.local/bin`) lo abre con la línea
  de comandos de RetroDECK, `flatpak run net.retrodeck.retrodeck -s <sistema> <rom>`. Solo
  acepta una consola conocida y un fichero de su carpeta.
- El sistema de ES-DE es el nombre de la carpeta, salvo `arcade`, que es `fbneo` (el `arcade` de
  ES-DE es MAME). ES-DE elige el emulador: el que tenga elegido para ese sistema o ese juego y, si
  no, el primero, con RetroArch y sus núcleos, que vienen con RetroDECK (Mesen para NES, Snes9x,
  Gambatte, mGBA, Genesis Plus GX y FinalBurn Neo).
- Las partidas guardadas, la pila del cartucho, los mandos, los shaders y el menú son los de
  RetroDECK, no los de la app: no se comparten con el navegador. Tampoco se cuenta el tiempo de
  juego.
- Al salir del juego vuelve a verse la Vista TV en Chromium.
- No está para los peques.
- Si no abre nada: `systemctl --user status jellycartoon-retrodeck.socket` y
  `journalctl --user -u 'jellycartoon-retrodeck@*'` en ese PC, y el Registro de la app.
