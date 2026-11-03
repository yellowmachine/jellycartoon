---
title: 'Modo DJ'
---

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
