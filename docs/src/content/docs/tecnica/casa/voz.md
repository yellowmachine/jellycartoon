---
title: 'Voz'
---

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
- **Fin de la charla, en los satélites**: un pitido (523 Hz) cuando deja de escuchar del todo, tras
  la respuesta o al agotarse la escucha sin la palabra. Si no entendió o hubo un error, el grave
  (440 Hz) ya hace de final.
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

## Mando del salón

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

| Tecla del mando | En el mpv del salón                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------- |
| OK o Menú       | Abre el menú; dentro, elige; con «¿Sigues ahí?», contesta                                       |
| Flechas         | En el menú, se mueven; sin menú, ↑ enseña los controles de mpv, ↓ los esconde y ← → saltan 10 s |
| Volver          | Cierra el menú; sin menú, para y se vuelve a la vista TV                                        |
| Play/Pausa      | Pausa o sigue                                                                                   |
| Inicio          | Para y se vuelve a la vista TV                                                                  |
| Encendido       | Pausa y trae la vista TV; otra vez, vuelve el vídeo y sigue                                     |
| Micrófono       | Habla, como en la vista TV; el vídeo se pausa mientras tanto                                    |
| Números         | Nada                                                                                            |
| Vol+ / Vol−     | El volumen del sistema (no llegan a mpv)                                                        |

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
