---
title: 'Una sola Raspberry: casa, satélite y juegos'
---

Para quien no quiere un PC: una Raspberry Pi 5 conectada a la tele por HDMI que hace de casa sin
vídeo, de satélite de voz y de pantalla para los juegos retro. Así no se ha probado aún: musicpi
(una Pi 4) es casa y altavoz Snapcast, pero sin satélite ni pantalla.

- **Qué hace falta:** una Pi 5 con Raspberry Pi OS de 64 bits **con escritorio** (4 GB bastan, 8
  van holgados), un SSD por USB mejor que la tarjeta SD, un micrófono USB, un altavoz y un mando
  de juego (Bluetooth o USB). La Pi 5 no tiene salida de auriculares: el altavoz del satélite,
  por USB, o el de la tele por HDMI.
- **1. La casa**, con `install.sh` como arriba. En una Raspberry es solo música, radio y podcasts
  (sin series ni películas: convertir vídeo es demasiado para ella) y sin Steam. Pregunta la
  carpeta de la música, la de los datos (en el SSD: también lleva la base de datos) y «¿Juegos
  retro en la Vista TV?»: con un sí, la carpeta de las ROMs, con una carpeta por consola ya
  creada (ver [Juegos](/tecnica/casa/juegos/)).
- **2. El satélite**, en otra carpeta, como dice [Satélite de voz](/tecnica/satelite/): se
  da de alta en Seilide, y su música (Snapcast) es la de esta misma casa.
- **3. La pantalla:** Chromium a pantalla completa en la Vista TV al encender, en
  `~/.config/labwc/autostart`:

  ```sh
  chromium --kiosk --enable-spatial-navigation https://<nombre>.local/tv &
  ```

  Antes, una vez, el certificado de la casa (`~/jellycartoon/jellycartoon-raiz.crt`) en ese
  Chromium: Ajustes → Privacidad y seguridad → Seguridad → Gestionar certificados → Autoridades →
  Importar, con «Confiar en este certificado para identificar sitios web». Y el mando de juego
  emparejado en el escritorio (Bluetooth).

Los juegos no se emulan en el servidor, sino en el Chromium de la Pi (EmulatorJS, en
WebAssembly). Con la Pi 5 deberían ir con soltura NES, Game Boy, Master System, Mega Drive, Super
Nintendo y GBA, y casi todas las recreativas; con la Pi 4, bien las ligeras, y Super Nintendo,
GBA y recreativas justas. Los shaders cuestan más: mejor sin ellos o los sencillos. Es una
estimación, sin medir. EmulatorJS se carga de su CDN: para jugar hace falta internet.

Lo que hay que mirar al probarlo: el escritorio tiene su propio sonido (PipeWire), que puede
coger la tarjeta del satélite y dejarlo sin oír ni sonar (ver [Satélite de voz](/tecnica/satelite/)). Lo seguro es
que el satélite use un micrófono y un altavoz USB que el escritorio no use, y el juego, el HDMI.
